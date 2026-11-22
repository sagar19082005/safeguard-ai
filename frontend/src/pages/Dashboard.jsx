import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { Camera, RefreshCw, Video } from "lucide-react";
import { api } from "../api";
import { LoadingPanel, PageHeader, ErrorBanner } from "../components/UI";

const num = (v) => (v ?? 0).toLocaleString();
const axis = { tick: { fill: "rgb(var(--muted))", fontSize: 12 }, stroke: "rgb(var(--line))", tickLine: false };

function Stat({ label, value, tone }) {
  return (
    <div className="rounded border border-line bg-surface p-4 shadow-sm">
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

function Panel({ title, note, children, empty }) {
  return (
    <section className="rounded border border-line bg-surface p-5 shadow-sm">
      <h2 className="font-medium">{title}</h2>
      {note && <p className="text-sm text-muted">{note}</p>}
      <div className="mt-4 h-60">
        {empty ? <p className="flex h-full items-center justify-center text-sm text-muted">{empty}</p> : children}
      </div>
    </section>
  );
}

const tip = {
  contentStyle: {
    background: "rgb(var(--surface))",
    border: "1px solid rgb(var(--line))",
    borderRadius: 6,
    fontSize: 13,
  },
  cursor: { fill: "rgb(var(--line) / 0.4)" },
};
const pieColors = ["rgb(var(--accent))", "rgb(var(--line))"];

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = () => {
    setLoading(true);
    api("/dashboard/summary")
      .then(setD)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 8000); // Polls every 8 seconds
    return () => clearInterval(t);
  }, []);

  if (error) return <ErrorBanner message={error} />;
  if (!d) return <LoadingPanel label="Loading dashboard metrics..." />;
  const noCams = d.cameras_online + d.cameras_offline === 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Safety compliance dashboard"
        description="Real-time statistics computed from live camera detection events and safety violations."
        action={<button
          className="flex items-center gap-1.5 rounded border border-line px-3 py-1.5 text-xs font-medium text-muted hover:bg-line/50"
          onClick={load}
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>}
      />

      {noCams && (
        <div className="rounded border border-line bg-surface p-4 text-sm flex items-center justify-between">
          <div>
            <span className="font-medium">No cameras connected.</span>{" "}
            <span className="text-muted">Connect your laptop webcam or smartphone from Camera Management to start live monitoring.</span>
          </div>
          <a href="/cameras" className="btn text-xs py-1.5 flex items-center gap-1">
            <Video className="h-3.5 w-3.5" /> Connect camera
          </a>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="People detected (24h)" value={num(d.people_detected)} />
        <Stat label="Compliant workers" value={num(d.compliant)} tone="text-emerald-600" />
        <Stat label="Non-compliant workers" value={num(d.non_compliant)} tone={d.non_compliant ? "text-rose-600 font-bold" : ""} />
        <Stat label="Safety compliance rate" value={d.compliance_pct == null ? "No data" : `${d.compliance_pct}%`} tone={d.compliance_pct != null && d.compliance_pct >= 90 ? "text-emerald-600" : d.compliance_pct != null ? "text-amber-600" : ""} />
        <Stat label="Violations recorded today" value={num(d.violations_today)} tone={d.violations_today ? "text-rose-600" : ""} />
        <Stat label="Active safety alerts" value={num(d.active_alerts)} tone={d.active_alerts ? "text-amber-600 font-bold" : ""} />
        <Stat label="Cameras online" value={num(d.cameras_online)} tone={d.cameras_online ? "text-emerald-600 font-medium" : ""} />
        <Stat label="Cameras offline" value={num(d.cameras_offline)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title="Violations trend, last 7 days" empty={d.trend.every((t) => !t.violations) && "No violations recorded this week."}>
            <ResponsiveContainer>
              <BarChart data={d.trend}>
                <CartesianGrid vertical={false} stroke="rgb(var(--line))" />
                <XAxis dataKey="date" {...axis} tickFormatter={(s) => new Date(s).toLocaleDateString(undefined, { weekday: "short" })} />
                <YAxis allowDecimals={false} {...axis} width={32} />
                <Tooltip {...tip} />
                <Bar dataKey="violations" fill="rgb(var(--accent))" radius={[3, 3, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        </div>
        <Panel title="Violations by PPE item" empty={!d.by_ppe.length && "No violations recorded yet."}>
          <ResponsiveContainer>
            <BarChart data={d.by_ppe} layout="vertical">
              <XAxis type="number" allowDecimals={false} {...axis} />
              <YAxis type="category" dataKey="name" {...axis} width={90} />
              <Tooltip {...tip} />
              <Bar dataKey="count" fill="rgb(var(--accent))" radius={[0, 3, 3, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Monthly violation trend" note="Daily totals for the last 30 days" empty={d.monthly_trend.every((t) => !t.violations) && "No violations recorded this month."}>
          <ResponsiveContainer>
            <LineChart data={d.monthly_trend}>
              <CartesianGrid vertical={false} stroke="rgb(var(--line))" />
              <XAxis dataKey="date" {...axis} tickFormatter={(s) => new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short" })} interval={4} />
              <YAxis allowDecimals={false} {...axis} width={32} />
              <Tooltip {...tip} />
              <Line type="monotone" dataKey="violations" stroke="rgb(var(--accent))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Safety compliance trend" note="Daily judged detections, last 7 days" empty={d.compliance_trend.every((t) => t.compliance_pct == null) && "No judged detections this week."}>
          <ResponsiveContainer>
            <LineChart data={d.compliance_trend}>
              <CartesianGrid vertical={false} stroke="rgb(var(--line))" />
              <XAxis dataKey="date" {...axis} tickFormatter={(s) => new Date(s).toLocaleDateString(undefined, { weekday: "short" })} />
              <YAxis domain={[0, 100]} {...axis} width={36} tickFormatter={(v) => `${v}%`} />
              <Tooltip {...tip} formatter={(v) => [`${v}%`, "Compliance"]} />
              <Line type="monotone" dataKey="compliance_pct" stroke="rgb(var(--ok))" strokeWidth={2} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Violations by camera" empty={!d.by_camera.length && "No camera violations recorded yet."}>
          <ResponsiveContainer>
            <BarChart data={d.by_camera} layout="vertical">
              <XAxis type="number" allowDecimals={false} {...axis} />
              <YAxis type="category" dataKey="name" {...axis} width={100} />
              <Tooltip {...tip} />
              <Bar dataKey="count" fill="rgb(var(--bad))" radius={[0, 3, 3, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Overall compliance" empty={d.compliance_pct == null && "No judged detections yet."}>
          {d.compliance_pct != null && <ResponsiveContainer>
            <PieChart>
              <Pie data={[{ name: "Compliant", value: d.compliance_pct }, { name: "Needs attention", value: 100 - d.compliance_pct }]} dataKey="value" innerRadius={58} outerRadius={82} startAngle={90} endAngle={-270}>
                {pieColors.map((color) => <Cell key={color} fill={color} />)}
              </Pie>
              <text x="50%" y="48%" textAnchor="middle" dominantBaseline="middle" fill="rgb(var(--ink))" fontSize="22" fontWeight="600">{d.compliance_pct}%</text>
              <text x="50%" y="62%" textAnchor="middle" dominantBaseline="middle" fill="rgb(var(--muted))" fontSize="11">compliant</text>
              <Tooltip {...tip} />
            </PieChart>
          </ResponsiveContainer>}
        </Panel>
        <Panel title="Most common violations" empty={!d.by_ppe.length && "No violations recorded yet."}>
          <ResponsiveContainer>
            <BarChart data={d.by_ppe.slice(0, 5)} layout="vertical">
              <XAxis type="number" allowDecimals={false} {...axis} />
              <YAxis type="category" dataKey="name" {...axis} width={90} />
              <Tooltip {...tip} />
              <Bar dataKey="count" fill="rgb(var(--warn))" radius={[0, 3, 3, 0]} maxBarSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <section className="rounded border border-line bg-surface p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div><h2 className="font-medium">Connected cameras</h2><p className="text-sm text-muted">Current camera status and assigned locations.</p></div>
          <a href="/live" className="btn flex items-center gap-1.5 text-xs py-1.5"><Video className="h-3.5 w-3.5" /> Open live monitoring</a>
        </div>
        {d.cameras.length ? <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{d.cameras.map((camera) => <div key={camera.id} className="flex items-center gap-3 rounded border border-line p-3"><Camera className="h-4 w-4 text-accent" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{camera.name}</p><p className="truncate text-xs capitalize text-muted">{camera.kind} · {camera.location}</p></div><span className={`text-xs font-medium ${camera.status === "online" ? "text-emerald-600" : "text-muted"}`}>{camera.status}</span></div>)}</div> : <p className="mt-4 text-sm text-muted">No cameras connected.</p>}
      </section>

      <Panel title="Violations by location" empty={!d.by_location.length && "No location-specific violation records yet."}>
        <ResponsiveContainer>
          <BarChart data={d.by_location}>
            <CartesianGrid vertical={false} stroke="rgb(var(--line))" />
            <XAxis dataKey="name" {...axis} />
            <YAxis allowDecimals={false} {...axis} width={32} />
            <Tooltip {...tip} />
            <Bar dataKey="count" fill="rgb(var(--accent))" radius={[3, 3, 0, 0]} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  );
}
