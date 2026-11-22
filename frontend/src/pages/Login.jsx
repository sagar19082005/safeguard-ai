import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { api } from "../api";
import { useAuth } from "../auth";

function Field({ id, label, value, onChange, type = "text", ...props }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <input className="field" type={type} required value={value} onChange={onChange} {...props} />
    </label>
  );
}

export default function Login() {
  const { user, login, register } = useAuth();
  const [setup, setSetup] = useState(false);
  const [f, setF] = useState({ organization: "", full_name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api("/auth/status").then((s) => setSetup(!s.initialized)).catch(() => {}); }, []);
  if (user) return <Navigate to="/" replace />;

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError("");
    try { setup ? await register(f) : await login(f.email, f.password); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_480px]">
      <section className="hidden flex-col justify-between border-r border-line bg-surface p-12 lg:flex">
        <div className="flex items-center gap-2.5"><ShieldCheck className="h-6 w-6 text-accent" strokeWidth={1.75} />
          <span className="font-semibold tracking-tight">SafeGuard AI</span></div>
        <div className="max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">Know who is missing protective equipment, as it happens.</h1>
          <p className="mt-4 leading-relaxed text-muted">Camera-based PPE monitoring for construction sites, factories and warehouses. Every alert comes with evidence a safety officer can review.</p>
        </div>
        <p className="text-sm text-muted">Detections are estimates. Uncertain results are flagged for human review.</p>
      </section>
      <section className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div><h2 className="text-xl font-semibold">{setup ? "Set up your organization" : "Sign in"}</h2>
            <p className="mt-1 text-sm text-muted">{setup ? "Create the first administrator account." : "Use your work email."}</p></div>
          {setup && <><Field id="organization" label="Organization name" value={f.organization} onChange={set("organization")} /><Field id="full_name" label="Your name" value={f.full_name} onChange={set("full_name")} /></>}
          <Field id="email" label="Email" value={f.email} onChange={set("email")} type="email" autoComplete="username" />
          <Field id="password" label="Password" value={f.password} onChange={set("password")} type="password" minLength={setup ? 10 : 1} autoComplete={setup ? "new-password" : "current-password"} />
          {setup && <p className="text-xs text-muted">At least 10 characters.</p>}
          {error && <p role="alert" className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</p>}
          <button className="btn w-full" disabled={busy}>
            {busy && <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            {busy ? "Please wait" : setup ? "Create account" : "Sign in"}
          </button>
        </form>
      </section>
    </div>
  );
}
