import { useEffect, useState } from "react";
import { UserPlus, UserRoundX, X } from "lucide-react";
import { api } from "../api";

const empty = { employee_code: "", name: "", department: "", designation: "", location_id: "", is_active: true };

export default function Workers() {
  const [workers, setWorkers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const [history, setHistory] = useState(null);
  const load = () => Promise.all([api("/workers"), api("/locations")]).then(([w, l]) => { setWorkers(w); setLocations(l); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const submit = async (event) => {
    event.preventDefault();
    try {
      await api("/workers", { method: "POST", body: { ...form, location_id: form.location_id ? Number(form.location_id) : null } });
      setForm(empty); load();
    } catch (e) { setError(e.message); }
  };
  const deactivate = async (id) => {
    try { await api(`/workers/${id}`, { method: "DELETE" }); load(); } catch (e) { setError(e.message); }
  };
  const viewHistory = async (id) => {
    try { setHistory(await api(`/workers/${id}/history`)); } catch (e) { setError(e.message); }
  };
  return <div className="space-y-6">
    <div><h1 className="text-xl font-semibold">Worker management</h1><p className="mt-1 text-sm text-muted">Maintain authorized worker records without using facial recognition.</p></div>
    {error && <p role="alert" className="rounded border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{error}</p>}
    <form onSubmit={submit} className="rounded border border-line bg-surface p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><UserPlus className="h-4 w-4 text-accent" />Add worker</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <input className="field" placeholder="Employee ID" required value={form.employee_code} onChange={(e) => setForm({ ...form, employee_code: e.target.value })} />
        <input className="field" placeholder="Full name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="field" placeholder="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
        <input className="field" placeholder="Designation" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
        <select className="field" value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}><option value="">No assigned location</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
      </div>
      <button className="btn mt-4">Add worker</button>
    </form>
    <section className="overflow-x-auto rounded border border-line bg-surface">
      <table className="w-full text-left text-sm"><thead className="border-b border-line text-xs text-muted"><tr><th className="p-4">Employee ID</th><th className="p-4">Name</th><th className="p-4">Department</th><th className="p-4">Location</th><th className="p-4">Status</th><th className="p-4" /></tr></thead>
        <tbody>{workers.map((worker) => <tr key={worker.id} className="border-b border-line last:border-0"><td className="p-4 font-medium">{worker.employee_code}</td><td className="p-4">{worker.name}<span className="block text-xs text-muted">{worker.designation || "—"}</span></td><td className="p-4">{worker.department || "—"}</td><td className="p-4">{worker.location_name || "Unassigned"}</td><td className="p-4">{worker.is_active ? <span className="text-emerald-600">Active</span> : <span className="text-muted">Inactive</span>}</td><td className="p-4 text-right"><div className="flex justify-end gap-3"><button className="text-xs text-accent hover:underline" onClick={() => viewHistory(worker.id)}>History</button>{worker.is_active && <button className="text-muted hover:text-bad" onClick={() => deactivate(worker.id)} title="Deactivate worker"><UserRoundX className="h-4 w-4" /></button>}</div></td></tr>)}</tbody>
      </table>
      {!workers.length && <p className="p-5 text-sm text-muted">No workers registered.</p>}
    </section>
    {history && <section className="rounded border border-line bg-surface p-5 shadow-sm">
      <div className="flex items-start justify-between"><div><h2 className="font-medium">{history.worker.name} safety history</h2><p className="text-sm text-muted">{history.worker.employee_code} · {history.total_violations} recorded violations</p></div><button aria-label="Close history" className="text-muted hover:text-ink" onClick={() => setHistory(null)}><X className="h-4 w-4" /></button></div>
      <div className="mt-4 flex flex-wrap gap-2 text-xs">{history.repeated_violation && <span className="rounded bg-rose-100 px-2 py-1 font-medium text-rose-700">Repeated violation pattern</span>}{history.by_ppe.map((item) => <span key={item.name} className="rounded bg-line/60 px-2 py-1">{item.name}: {item.count}</span>)}</div>
      <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-line text-xs text-muted"><tr><th className="p-2">Date</th><th className="p-2">Missing PPE</th><th className="p-2">Camera</th><th className="p-2">Location</th><th className="p-2">Status</th></tr></thead><tbody>{history.violations.map((item) => <tr key={item.id} className="border-b border-line last:border-0"><td className="p-2">{item.created_at ? new Date(item.created_at).toLocaleString() : "—"}</td><td className="p-2">{item.missing_item}</td><td className="p-2">{item.camera_name}</td><td className="p-2">{item.location_name}</td><td className="p-2 capitalize">{item.review_status.replace("_", " ")}</td></tr>)}</tbody></table>{!history.violations.length && <p className="p-3 text-sm text-muted">No linked violations for this worker.</p>}</div>
    </section>}
  </div>;
}
