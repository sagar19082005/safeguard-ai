import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, FileBarChart } from "lucide-react";
import { api, token } from "../api";

const chartTip = { contentStyle: { background: "rgb(var(--surface))", border: "1px solid rgb(var(--line))", fontSize: 13 } };

export default function Reports() {
  const [period, setPeriod] = useState("week");
  const [filters, setFilters] = useState({ location_id: "", camera_id: "", ppe_type_id: "", worker_id: "" });
  const [options, setOptions] = useState({ locations: [], cameras: [], ppe_types: [], workers: [] });
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setData(null);
    const query = new URLSearchParams({ period, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) });
    api(`/reports/summary?${query}`).then(setData).catch((e) => setError(e.message));
  }, [period, filters]);
  useEffect(() => { api("/reports/filters").then(setOptions).catch((e) => setError(e.message)); }, []);

  const download = (format) => {
    const query = new URLSearchParams({ period, ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value)) });
    const url = `/api/reports/export.${format}?${query}`;
    fetch(url, { headers: { Authorization: `Bearer ${token.get()}` } })
      .then(async (res) => {
        if (!res.ok) throw new Error("Report export failed.");
        const blob = await res.blob();
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `safeguard-${period}-report.${format}`;
        link.click();
        URL.revokeObjectURL(link.href);
      })
      .catch((e) => setError(e.message));
  };

  if (error) return <p role="alert" className="text-bad">{error}</p>;
  if (!data) return <p className="text-muted">Loading safety report...</p>;
  const byItem = Object.entries(data.analytics.reduce((result, row) => {
    result[row.missing_item] = (result[row.missing_item] || 0) + row.count;
    return result;
  }, {})).map(([name, count]) => ({ name, count }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Reports and analytics</h1>
          <p className="text-sm text-muted">Safety performance computed from stored detection events and violations.</p>
        </div>
        <div className="flex gap-2">
          <select className="rounded border border-line bg-surface px-3 py-2 text-sm" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="day">Today</option><option value="week">Last 7 days</option><option value="month">This month</option>
          </select>
          <button className="btn flex items-center gap-1.5 text-xs" onClick={() => download("csv")}><Download className="h-3.5 w-3.5" /> CSV</button>
          <button className="btn flex items-center gap-1.5 text-xs" onClick={() => download("pdf")}><FileBarChart className="h-3.5 w-3.5" /> PDF</button>
        </div>
        <section className="grid gap-3 rounded border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5">
          <select className="field" value={filters.location_id} onChange={(e) => setFilters({ ...filters, location_id: e.target.value })}><option value="">All locations</option>{options.locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <select className="field" value={filters.camera_id} onChange={(e) => setFilters({ ...filters, camera_id: e.target.value })}><option value="">All cameras</option>{options.cameras.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <select className="field" value={filters.worker_id} onChange={(e) => setFilters({ ...filters, worker_id: e.target.value })}><option value="">All workers</option>{options.workers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <select className="field" value={filters.ppe_type_id} onChange={(e) => setFilters({ ...filters, ppe_type_id: e.target.value })}><option value="">All PPE categories</option>{options.ppe_types.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <button className="rounded border border-line px-3 py-2 text-sm text-muted hover:bg-line/40" onClick={() => setFilters({ location_id: "", camera_id: "", ppe_type_id: "", worker_id: "" })}>Clear filters</button>
        </section>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded border border-line bg-surface p-4"><p className="text-sm text-muted">Compliance score</p><p className="mt-1 text-2xl font-semibold text-emerald-600">{data.compliance_score == null ? "No data" : `${data.compliance_score}%`}</p></div>
        <div className="rounded border border-line bg-surface p-4"><p className="text-sm text-muted">Total detections</p><p className="mt-1 text-2xl font-semibold">{data.detections.total.toLocaleString()}</p></div>
        <div className="rounded border border-line bg-surface p-4"><p className="text-sm text-muted">Violations</p><p className="mt-1 text-2xl font-semibold text-rose-600">{data.violation_total.toLocaleString()}</p></div>
        <div className="rounded border border-line bg-surface p-4"><p className="text-sm text-muted">Uncertain detections</p><p className="mt-1 text-2xl font-semibold text-amber-600">{data.detections.uncertain.toLocaleString()}</p></div>
      </div>
      <section className="rounded border border-line bg-surface p-5 shadow-sm">
        <h2 className="font-medium">Violations by missing PPE</h2>
        <p className="text-sm text-muted">{data.from} to {data.to}</p>
        <div className="mt-4 h-72">
          {byItem.length ? <ResponsiveContainer><BarChart data={byItem}><CartesianGrid vertical={false} stroke="rgb(var(--line))" /><XAxis dataKey="name" tick={{ fill: "rgb(var(--muted))", fontSize: 12 }} /><YAxis allowDecimals={false} tick={{ fill: "rgb(var(--muted))", fontSize: 12 }} /><Tooltip {...chartTip} /><Bar dataKey="count" fill="rgb(var(--accent))" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer> : <p className="flex h-full items-center justify-center text-sm text-muted">No violations recorded for this period.</p>}
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
        {[["by_worker", "Worker-wise violations"], ["by_location", "Location-wise violations"], ["by_camera", "Camera-wise violations"]].map(([key, title]) => <section key={key} className="rounded border border-line bg-surface p-5 shadow-sm"><h2 className="font-medium">{title}</h2><div className="mt-4 space-y-2">{data[key].map((item) => <div key={item.name} className="flex justify-between text-sm"><span className="truncate">{item.name}</span><span className="font-medium text-rose-600">{item.count}</span></div>)}{!data[key].length && <p className="text-sm text-muted">No records for this report.</p>}</div></section>)}
      </div>
    </div>
  );
}
