import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { api } from "../api";

const initial = { camera_id: "", name: "", polygon: "0.10,0.10; 0.90,0.10; 0.90,0.90; 0.10,0.90", enabled: true };
function parsePolygon(value) { return value.split(";").map((point) => point.trim().split(",").map(Number)); }

export default function Zones() {
  const [zones, setZones] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [form, setForm] = useState(initial);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState("");
  const load = () => Promise.all([api("/zones"), api("/cameras")]).then(([z, c]) => { setZones(z); setCameras(c); setForm((current) => ({ ...current, camera_id: current.camera_id || String(c[0]?.id || "") })); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const submit = async (event) => {
    event.preventDefault();
    try {
      await api(editingId ? `/zones/${editingId}` : "/zones", {
        method: editingId ? "PATCH" : "POST",
        body: { camera_id: Number(form.camera_id), name: form.name, polygon: parsePolygon(form.polygon), enabled: form.enabled },
      });
      setEditingId(null);
      setForm({ ...initial, camera_id: form.camera_id });
      load();
    }
    catch (e) { setError(e.message); }
  };
  const edit = (zone) => {
    setEditingId(zone.id);
    setForm({
      camera_id: String(zone.camera_id),
      name: zone.name,
      polygon: zone.polygon.map(([x, y]) => `${x},${y}`).join("; "),
      enabled: zone.enabled,
    });
    setError("");
  };
  const cancelEdit = () => {
    setEditingId(null);
    setForm(initial);
  };
  const remove = async (id) => { try { await api(`/zones/${id}`, { method: "DELETE" }); load(); } catch (e) { setError(e.message); } };
  const polygon = parsePolygon(form.polygon).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const addPoint = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    setForm({ ...form, polygon: [...polygon, [x, y]].map(([px, py]) => `${px.toFixed(3)},${py.toFixed(3)}`).join("; ") });
  };
  return <div className="space-y-6">
    <div><h1 className="text-xl font-semibold">Restricted zones</h1><p className="mt-1 text-sm text-muted">Define and edit normalized polygon areas inside camera frames for zone-entry alerts.</p></div>
    {error && <p role="alert" className="rounded border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{error}</p>}
    <form onSubmit={submit} className="rounded border border-line bg-surface p-5"><div className="grid gap-3 md:grid-cols-3"><input className="field" placeholder="Zone name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><select className="field" required value={form.camera_id} onChange={(e) => setForm({ ...form, camera_id: e.target.value })}><option value="">Select camera</option>{cameras.map((camera) => <option key={camera.id} value={camera.id}>{camera.name}</option>)}</select><input className="field md:col-span-3" placeholder="x,y; x,y; x,y (values 0 to 1)" required value={form.polygon} onChange={(e) => setForm({ ...form, polygon: e.target.value })} /></div><div className="mt-3 max-w-xl"><p className="mb-1 text-xs text-muted">Click the preview to add normalized polygon points.</p><svg viewBox="0 0 1 1" className="h-48 w-full cursor-crosshair rounded border border-line bg-black/5" onClick={addPoint} role="img" aria-label="Restricted zone polygon editor"><polygon points={polygon.map(([x, y]) => `${x},${y}`).join(" ")} fill="rgb(var(--accent) / 0.18)" stroke="rgb(var(--accent))" strokeWidth="0.008" />{polygon.map(([x, y], index) => <circle key={`${x}-${y}-${index}`} cx={x} cy={y} r="0.018" fill="rgb(var(--accent))" />)}</svg><button type="button" className="mt-2 text-xs text-muted hover:text-ink" onClick={() => setForm({ ...form, polygon: "" })}>Clear points</button></div><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />Zone monitoring enabled</label><p className="mt-2 text-xs text-muted">Use at least three points. Zone-entry alerts use the worker feet position.</p><div className="mt-3 flex gap-2"><button className="btn" disabled={!cameras.length}>{editingId ? "Save zone" : "Add restricted zone"}</button>{editingId && <button type="button" className="rounded border border-line px-3 py-2 text-sm" onClick={cancelEdit}>Cancel</button>}</div></form>
    <section className="space-y-3">{zones.map((zone) => <article key={zone.id} className="flex items-center justify-between rounded border border-line bg-surface p-4"><div><p className="font-medium">{zone.name}</p><p className="text-xs text-muted">{zone.camera_name} · {zone.polygon.length} points · {zone.enabled ? "enabled" : "disabled"}</p></div><div className="flex items-center gap-2"><button className="text-muted hover:text-accent" onClick={() => edit(zone)} aria-label={`Edit ${zone.name}`}><Pencil className="h-4 w-4" /></button><button className="text-muted hover:text-bad" onClick={() => remove(zone.id)} aria-label={`Delete ${zone.name}`}><Trash2 className="h-4 w-4" /></button></div></article>)}{!zones.length && <p className="text-sm text-muted">No restricted zones configured.</p>}</section>
  </div>;
}
