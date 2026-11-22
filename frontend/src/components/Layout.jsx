import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Moon, Sun, LogOut, Menu, ShieldCheck } from "lucide-react";
import { NAV } from "../nav";
import { useAuth } from "../auth";
import { token } from "../api";

function playAlertSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 740;
    gain.gain.setValueAtTime(0.18, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + 0.3);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.3);
  } catch {
    // Browser autoplay policies can block sounds until user interaction.
  }
}

export default function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem("sg_theme") === "dark");
  const [liveAlert, setLiveAlert] = useState(null);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("sg_theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    const accessToken = token.get();
    if (!accessToken) return undefined;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/alerts/stream?token=${encodeURIComponent(accessToken)}`);
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type !== "alert") return;
      const alert = message.alert;
      setLiveAlert(alert);
      window.dispatchEvent(new CustomEvent("safeguard-alert", { detail: alert }));
      playAlertSound();
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(`SafeGuard AI: ${alert.missing_item} missing`, {
          body: `${alert.camera_name} · ${alert.location_name || "Unassigned location"}`,
        });
      }
      window.setTimeout(() => setLiveAlert(null), 6000);
    };
    return () => socket.close();
  }, []);

  const link = ({ isActive }) =>
    `flex items-center gap-3 rounded-md px-3 py-2.5 text-sm ${isActive
      ? "bg-accent/10 font-semibold text-accent shadow-[inset_2px_0_0_rgb(var(--accent))]" : "text-muted hover:bg-line/50 hover:text-ink"}`;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      {open && <button className="fixed inset-0 z-10 bg-black/40 lg:hidden" aria-label="Close navigation" onClick={() => setOpen(false)} />}
      <aside className={`${open ? "translate-x-0" : "-translate-x-full"} fixed inset-y-0 z-20 w-64 overflow-y-auto border-r border-line bg-surface p-4 shadow-xl transition-transform duration-200 lg:static lg:block lg:w-auto lg:translate-x-0 lg:shadow-none`}>
        <div className="mb-6 flex items-center justify-between px-1">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/10"><ShieldCheck className="h-5 w-5 text-accent" strokeWidth={1.75} /></span>
            <span className="text-[15px] font-semibold tracking-tight">SafeGuard AI</span>
          </div>
          <button className="rounded p-1.5 text-muted hover:bg-line/60 lg:hidden" aria-label="Close navigation" onClick={() => setOpen(false)}>×</button>
        </div>
        <nav className="space-y-5" onClick={() => setOpen(false)}>
          {NAV.map((g) => (
            <div key={g.group}>
              <p className="mb-1 px-3 text-xs font-medium text-muted">{g.group}</p>
              {g.items.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} end={to === "/"} className={link}>
                  <Icon className="h-4 w-4" strokeWidth={1.75} />{label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-line bg-surface/90 px-4 backdrop-blur-xl lg:px-8">
          <button className="rounded-md p-2 text-muted hover:bg-line/60 lg:hidden" aria-label="Open navigation" onClick={() => setOpen(!open)}><Menu className="h-5 w-5" /></button>
          <div className="hidden text-sm font-medium text-muted lg:block">Safety monitoring console</div>
          <div className="flex items-center gap-3">
            <button className="rounded p-2 text-muted hover:bg-line/60" aria-label="Toggle theme" onClick={() => setDark(!dark)}>
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <div className="text-right leading-tight">
              <p className="text-sm font-medium">{user.full_name}</p>
              <p className="text-xs capitalize text-muted">{user.role.replace("_", " ")}</p>
            </div>
            <button className="rounded p-2 text-muted hover:bg-line/60" aria-label="Sign out" onClick={logout}><LogOut className="h-4 w-4" /></button>
          </div>
        </header>
        {liveAlert && <button className="fixed right-4 top-16 z-30 max-w-sm rounded border border-rose-300 bg-rose-50 p-4 text-left text-sm shadow-lg" onClick={() => { window.location.assign("/alerts"); }}>
          <p className="font-semibold text-rose-800">New safety alert: missing {liveAlert.missing_item}</p>
          <p className="mt-1 text-xs text-rose-700">{liveAlert.camera_name} · Click to review</p>
        </button>}
        <main className="page-enter mx-auto max-w-[1280px] p-4 lg:p-8"><Outlet /></main>
      </div>
    </div>
  );
}
