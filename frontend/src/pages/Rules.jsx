import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { api } from "../api";

export default function Rules() {
  const [locations, setLocations] = useState([]);
  const [types, setTypes] = useState([]);
  const [rules, setRules] = useState([]);
  const [form, setForm] = useState({ location_id: "", ppe_type_id: "", requirement: "required", severity: "high" });
  const [locationName, setLocationName] = useState("");
  const [error, setError] = useState("");

  const load = () => Promise.all([api("/locations"), api("/rules/ppe-types"), api("/rules")])
    .then(([locationList, typeList, ruleList]) => {
      setLocations(locationList);
      setTypes(typeList);
      setRules(ruleList);
      setForm((current) => ({
        ...current,
        location_id: current.location_id || String(locationList[0]?.id || ""),
        ppe_type_id: current.ppe_type_id || String(typeList[0]?.id || ""),
      }));
    }).catch((err) => setError(err.message));

  useEffect(() => { load(); }, []);

  const createLocation = async (event) => {
    event.preventDefault();
    try {
      const location = await api("/locations", { method: "POST", body: { name: locationName.trim() } });
      setLocations((items) => [...items, location].sort((a, b) => a.name.localeCompare(b.name)));
      setForm((current) => ({ ...current, location_id: String(location.id) }));
      setLocationName("");
    } catch (err) { setError(err.message); }
  };

  const createRule = async (event) => {
    event.preventDefault();
    try {
      const rule = await api("/rules", { method: "POST", body: {
        ...form, location_id: Number(form.location_id), ppe_type_id: Number(form.ppe_type_id),
      } });
      setRules((items) => [...items, rule]);
    } catch (err) { setError(err.message); }
  };

  const remove = async (id) => {
    try { await api(`/rules/${id}`, { method: "DELETE" }); setRules((items) => items.filter((rule) => rule.id !== id)); }
    catch (err) { setError(err.message); }
  };

  return <div className="space-y-6">
    <div><h1 className="text-xl font-semibold">Safety rules</h1><p className="mt-1 text-sm text-muted">Configure mandatory PPE by workplace location.</p></div>
    {error && <p role="alert" className="rounded border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{error}</p>}
    <section className="grid gap-4 md:grid-cols-2">
      <form onSubmit={createLocation} className="rounded border border-line bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold">Add workplace location</h2>
        <div className="flex gap-2"><input className="field min-w-0 flex-1" placeholder="Construction Zone A" required value={locationName} onChange={(e) => setLocationName(e.target.value)} /><button className="btn">Add</button></div>
      </form>
      <form onSubmit={createRule} className="rounded border border-line bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold">Add PPE requirement</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <select className="field" required value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <select className="field" required value={form.ppe_type_id} onChange={(e) => setForm({ ...form, ppe_type_id: e.target.value })}>{types.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <select className="field" value={form.requirement} onChange={(e) => setForm({ ...form, requirement: e.target.value })}><option value="required">Required</option><option value="optional">Optional</option></select>
          <select className="field" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="review">Review</option></select>
        </div>
        <button className="btn mt-3" disabled={!locations.length}>Save rule</button>
      </form>
    </section>
    <section className="rounded border border-line bg-surface">
      <div className="border-b border-line p-4 text-sm font-semibold">Configured requirements ({rules.length})</div>
      {rules.map((rule) => <div key={rule.id} className="flex items-center justify-between gap-3 border-b border-line p-4 text-sm last:border-0"><div><p className="font-medium">{rule.location_name} · {rule.ppe_name}</p><p className="text-xs text-muted capitalize">{rule.requirement} · {rule.severity} severity</p></div><button className="text-muted hover:text-bad" onClick={() => remove(rule.id)} aria-label={`Delete ${rule.ppe_name} rule`}><Trash2 className="h-4 w-4" /></button></div>)}
      {!rules.length && <p className="p-5 text-sm text-muted">No rules configured yet.</p>}
    </section>
  </div>;
}
