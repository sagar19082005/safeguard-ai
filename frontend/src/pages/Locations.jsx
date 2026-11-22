import { useEffect, useState } from "react";
import { MapPin, Pencil, Trash2 } from "lucide-react";
import { api } from "../api";

export default function Locations() {
  const [locations, setLocations] = useState([]);
  const [form, setForm] = useState({ name: "", site: "" });
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const load = () => api("/locations").then(setLocations).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const submit = async (event) => {
    event.preventDefault();
    try { await api(editing ? `/locations/${editing}` : "/locations", { method: editing ? "PATCH" : "POST", body: form }); setForm({ name: "", site: "" }); setEditing(null); load(); }
    catch (e) { setError(e.message); }
  };
  const remove = async (id) => { try { await api(`/locations/${id}`, { method: "DELETE" }); load(); } catch (e) { setError(e.message); } };
  return <div className="space-y-6">
    <div><h1 className="text-xl font-semibold">Workplace locations</h1><p className="mt-1 text-sm text-muted">Create and maintain zones used by cameras, workers, and PPE rules.</p></div>
    {error && <p role="alert" className="rounded border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{error}</p>}
    <form onSubmit={submit} className="flex flex-col gap-3 rounded border border-line bg-surface p-5 sm:flex-row"><input className="field flex-1" placeholder="Location name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><input className="field flex-1" placeholder="Site (optional)" value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} /><button className="btn">{editing ? "Save changes" : "Add location"}</button>{editing && <button type="button" className="rounded border border-line px-3 text-sm" onClick={() => { setEditing(null); setForm({ name: "", site: "" }); }}>Cancel</button>}</form>
    <section className="grid gap-4 md:grid-cols-2">{locations.map((location) => <article key={location.id} className="flex items-center justify-between rounded border border-line bg-surface p-5"><div className="flex items-center gap-3"><MapPin className="h-5 w-5 text-accent" /><div><h2 className="font-medium">{location.name}</h2><p className="text-xs text-muted">{location.site || "Site not specified"}</p></div></div><div className="flex gap-2"><button className="text-muted hover:text-ink" onClick={() => { setEditing(location.id); setForm({ name: location.name, site: location.site || "" }); }} aria-label={`Edit ${location.name}`}><Pencil className="h-4 w-4" /></button><button className="text-muted hover:text-bad" onClick={() => remove(location.id)} aria-label={`Delete ${location.name}`}><Trash2 className="h-4 w-4" /></button></div></article>)}{!locations.length && <p className="text-sm text-muted">No locations configured.</p>}</section>
  </div>;
}
