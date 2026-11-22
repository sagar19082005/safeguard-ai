import { useEffect, useState } from "react";
import { Activity, Camera, MapPin, ShieldAlert, Users } from "lucide-react";
import { api, evidenceUrl } from "../api";

function Panel({ title, children }) {
  return <section className="rounded border border-line bg-surface p-5 shadow-sm"><h2 className="font-medium">{title}</h2><div className="mt-4">{children}</div></section>;
}

export default function Analytics() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { api("/analytics/advanced").then(setData).catch((e) => setError(e.message)); }, []);
  if (error) return <p role="alert" className="text-bad">{error}</p>;
  if (!data) return <p className="text-muted">Loading advanced safety analytics...</p>;
  const estimate = data.predictive_estimate;
  return <div className="space-y-6">
    <div><h1 className="text-xl font-semibold">Advanced safety analytics</h1><p className="mt-1 text-sm text-muted">Patterns computed from confirmed database records. Predictive values are estimates, not future incident predictions.</p></div>
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title="Predictive estimate"><div className="flex items-center gap-3"><Activity className="h-8 w-8 text-accent" /><div><p className="text-2xl font-semibold capitalize">{estimate.trend.replace("_", " ")}</p><p className="text-xs text-muted">{estimate.current_violations} violations this week vs {estimate.previous_violations} prior week</p></div></div></Panel>
      <Panel title="Evidence retention"><div className="flex items-center gap-3"><ShieldAlert className="h-8 w-8 text-warn" /><div><p className="text-2xl font-semibold">{data.retention_days} days</p><p className="text-xs text-muted">Organization retention setting</p></div></div></Panel>
      <Panel title="Repeated violations"><div className="flex items-center gap-3"><Users className="h-8 w-8 text-bad" /><div><p className="text-2xl font-semibold">{data.repeated_violations.length}</p><p className="text-xs text-muted">Workers with 3+ recorded violations</p></div></div></Panel>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Compliance by workplace"><div className="space-y-3">{data.compliance_by_location.map((item) => <div key={item.name}><div className="flex justify-between text-sm"><span>{item.name}</span><span>{item.compliance_pct == null ? "No judged data" : `${item.compliance_pct}%`}</span></div><div className="mt-1 h-2 rounded bg-line"><div className="h-2 rounded bg-accent" style={{ width: `${item.compliance_pct || 0}%` }} /></div></div>)}{!data.compliance_by_location.length && <p className="text-sm text-muted">No location detection data.</p>}</div></Panel>
      <Panel title="Safety heatmap"><div className="space-y-3">{data.safety_heatmap.map((item) => <div key={item.name} className="flex items-center gap-3"><MapPin className="h-4 w-4 text-bad" /><span className="w-32 truncate text-sm">{item.name}</span><div className="h-5 flex-1 rounded bg-rose-100"><div className="h-5 rounded bg-rose-500" style={{ width: `${Math.max(item.intensity * 100, item.count ? 4 : 0)}%` }} /></div><span className="w-8 text-right text-sm font-medium">{item.count}</span></div>)}{!data.safety_heatmap.length && <p className="text-sm text-muted">No location violations in the last 7 days.</p>}</div></Panel>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Repeated violation patterns"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-line text-xs text-muted"><tr><th className="p-2">Worker</th><th className="p-2">Employee ID</th><th className="p-2">Violations</th></tr></thead><tbody>{data.repeated_violations.map((item) => <tr key={item.worker_id} className="border-b border-line last:border-0"><td className="p-2">{item.name}</td><td className="p-2">{item.employee_code}</td><td className="p-2 font-medium text-bad">{item.count}</td></tr>)}</tbody></table>{!data.repeated_violations.length && <p className="p-2 text-sm text-muted">No repeated worker patterns found.</p>}</div></Panel>
      <Panel title="Camera health"><div className="space-y-2">{data.camera_health.map((camera) => <div key={camera.id} className="flex items-center gap-3 rounded border border-line p-3"><Camera className="h-4 w-4 text-accent" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{camera.name}</p><p className="text-xs text-muted">{camera.kind} · {camera.detection_events} detection events</p></div><span className={`text-xs font-medium ${camera.status === "online" ? "text-emerald-600" : "text-muted"}`}>{camera.status}</span></div>)}{!data.camera_health.length && <p className="text-sm text-muted">No cameras configured.</p>}</div></Panel>
    </div>
  </div>;
}
