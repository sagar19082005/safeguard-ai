import { useEffect, useState } from "react";
import { BellRing, Check, ExternalLink, RefreshCw } from "lucide-react";
import { api, evidenceUrl } from "../api";

const statusOptions = ["new", "acknowledged", "under_review", "resolved", "false_positive", "escalated"];

function severityClass(severity) {
  if (severity === "critical") return "bg-rose-100 text-rose-800";
  if (severity === "high") return "bg-orange-100 text-orange-800";
  return "bg-amber-100 text-amber-800";
}

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [filter, setFilter] = useState("");
  const [comments, setComments] = useState({});
  const [error, setError] = useState("");
  const load = () => api(`/alerts${filter ? `?status=${filter}` : ""}`).then(setAlerts).catch((err) => setError(err.message));

  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener("safeguard-alert", refresh);
    const timer = window.setInterval(load, 10000);
    return () => { window.removeEventListener("safeguard-alert", refresh); window.clearInterval(timer); };
  }, [filter]);

  const update = async (alert, status) => {
    try {
      await api(`/alerts/${alert.id}`, {
        method: "PATCH",
        body: { status, comment: comments[alert.id] ?? alert.comment ?? null },
      });
      load();
    } catch (err) { setError(err.message); }
  };
  const enableBrowserNotifications = async () => {
    if ("Notification" in window) await Notification.requestPermission();
  };

  return <div className="space-y-6">
    <div className="flex items-start justify-between gap-4">
      <div><h1 className="text-xl font-semibold">Alert center</h1><p className="mt-1 text-sm text-muted">Review, acknowledge, and resolve real-time safety alerts.</p></div>
      <button className="rounded border border-line p-2 text-muted hover:bg-line/50" onClick={load} aria-label="Refresh alerts"><RefreshCw className="h-4 w-4" /></button>
    </div>
    {error && <p role="alert" className="rounded border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{error}</p>}
    <div className="flex flex-wrap items-center gap-3">
      <BellRing className="h-4 w-4 text-accent" />
      <select className="field max-w-xs py-1.5 text-sm" value={filter} onChange={(e) => setFilter(e.target.value)}>
        <option value="">All alerts</option>{statusOptions.map((item) => <option key={item} value={item}>{item.replace("_", " ")}</option>)}
      </select>
      <span className="text-xs text-muted">{alerts.length} alert(s)</span>
      {"Notification" in window && Notification.permission !== "granted" && <button className="btn py-1.5 text-xs" onClick={enableBrowserNotifications}>Enable browser notifications</button>}
    </div>
    <section className="space-y-3">
      {!alerts.length && <div className="rounded border border-dashed border-line p-8 text-center text-sm text-muted">No alerts match this filter.</div>}
      {alerts.map((alert) => <article key={alert.id} className="rounded border border-line bg-surface p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex gap-3">
            <div className={`mt-0.5 rounded px-2 py-1 text-[11px] font-semibold uppercase ${severityClass(alert.severity)}`}>{alert.severity}</div>
            <div>
              <h2 className="font-medium">Missing {alert.missing_item}</h2>
              <p className="mt-1 text-sm text-muted">{alert.location_name || "Unassigned location"} · {alert.camera_name}</p>
              <p className="mt-1 text-xs text-muted">Worker #{alert.tracking_id ?? "unknown"} · {alert.created_at ? new Date(alert.created_at).toLocaleString() : "-"}</p>
            </div>
          </div>
          <select className="field w-full py-1.5 text-xs md:w-40" value={alert.status} onChange={(e) => update(alert, e.target.value)}>
            {statusOptions.map((item) => <option key={item} value={item}>{item.replace("_", " ")}</option>)}
          </select>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input className="field flex-1 py-1.5 text-xs" placeholder="Add review comment..." value={comments[alert.id] ?? alert.comment ?? ""} onChange={(e) => setComments({ ...comments, [alert.id]: e.target.value })} />
          <button className="btn py-1.5 text-xs" onClick={() => update(alert, alert.status)}><Check className="mr-1 h-3.5 w-3.5" />Save comment</button>
          {alert.evidence_path && <a className="rounded border border-line p-2 text-muted hover:bg-line/50" href={evidenceUrl(alert.evidence_path)} target="_blank" rel="noreferrer" title="View evidence"><ExternalLink className="h-4 w-4" /></a>}
        </div>
      </article>)}
    </section>
  </div>;
}
