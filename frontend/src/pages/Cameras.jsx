import { useEffect, useRef, useState } from "react";
import { Camera as CameraIcon, Copy, ExternalLink, MonitorUp, QrCode, Smartphone, Trash2, Video } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { api } from "../api";
import { ErrorBanner, PageHeader, StatusBadge } from "../components/UI";

const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

const kinds = [
  { value: "mobile", label: "Mobile camera", icon: Smartphone },
  { value: "webcam", label: "Laptop webcam", icon: MonitorUp },
  { value: "video", label: "Recorded video demo", icon: Video },
  { value: "ip", label: "IP / RTSP camera", icon: CameraIcon },
];

export default function Cameras() {
  const [cameras, setCameras] = useState([]);
  const [locations, setLocations] = useState([]);
  const [form, setForm] = useState({ name: "", kind: "mobile", stream_url: "", location_id: "" });
  const [mobileUrl, setMobileUrl] = useState("");
  const [useLocalUrl, setUseLocalUrl] = useState(false);
  const [rawToken, setRawToken] = useState("");
  const [activeCameraName, setActiveCameraName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const videoRef = useRef(null);
  const peerRef = useRef(null);
  const signalRef = useRef(null);

  const load = () => Promise.all([api("/cameras"), api("/locations")])
    .then(([cameraList, locationList]) => { setCameras(cameraList); setLocations(locationList); })
    .catch((err) => setError(err.message));
  useEffect(() => { load(); return () => stopPreview(); }, []);

  const stopPreview = () => {
    peerRef.current?.close();
    signalRef.current?.close();
    if (videoRef.current?.srcObject) videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
    peerRef.current = null;
    signalRef.current = null;
  };

  const showMobileQR = async (camera) => {
    setError("");
    try {
      const { token, connection_url: configuredUrl } = await api(`/cameras/${camera.id}/mobile-token`, { method: "POST" });
      setRawToken(token);
      setMobileUrl(configuredUrl || `${window.location.origin}/camera/connect?token=${encodeURIComponent(token)}`);
      setActiveCameraName(camera.name);
      connectAdminPeer(camera.id, token);
    } catch (err) {
      setError(err.message || "Failed to generate mobile connection link.");
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const camera = await api("/cameras", {
        method: "POST",
        body: {
          ...form,
          name: form.name.trim(),
          location_id: form.location_id ? Number(form.location_id) : null,
          stream_url: form.kind === "ip" ? form.stream_url.trim() || null : null,
        },
      });
      setCameras((items) => [...items, camera].sort((a, b) => a.name.localeCompare(b.name)));
      setForm({ name: "", kind: "mobile", stream_url: "", location_id: "" });
      if (camera.kind === "mobile") {
        await showMobileQR(camera);
      } else if (camera.kind === "webcam") {
        await startWebcam(camera.id);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const startWebcam = async (cameraId) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stopPreview();
      if (videoRef.current) videoRef.current.srcObject = stream;
      await api(`/cameras/${cameraId}/status`, { method: "PATCH", body: { status: "online" } });
      setCameras((items) => items.map((camera) => camera.id === cameraId ? { ...camera, status: "online" } : camera));
    } catch (err) {
      await api(`/cameras/${cameraId}/status`, { method: "PATCH", body: { status: "error" } }).catch(() => {});
      setError(err.message || "Unable to access the laptop webcam.");
    }
  };

  const connectAdminPeer = (cameraId, token) => {
    stopPreview();
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/cameras/signal/${token}`);
    const peer = new RTCPeerConnection(rtcConfig);
    const pendingIce = [];
    peer.ontrack = (event) => {
      if (videoRef.current) videoRef.current.srcObject = event.streams[0];
    };
    ws.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "offer") {
        await peer.setRemoteDescription(message);
        for (const candidate of pendingIce.splice(0)) await peer.addIceCandidate(candidate);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        ws.send(JSON.stringify({ type: "answer", sdp: answer.sdp }));
      } else if (message.type === "ice" && message.candidate) {
        if (peer.remoteDescription) await peer.addIceCandidate(message.candidate);
        else pendingIce.push(message.candidate);
      }
    };
    peer.onicecandidate = (event) => {
      if (event.candidate && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ice", candidate: event.candidate }));
    };
    signalRef.current = ws;
    peerRef.current = peer;
    void cameraId;
  };

  const remove = async (id) => {
    try {
      await api(`/cameras/${id}`, { method: "DELETE" });
      setCameras((items) => items.filter((camera) => camera.id !== id));
      if (activeCameraName) setMobileUrl("");
    } catch (err) {
      setError(err.message);
    }
  };

  const effectiveMobileUrl = rawToken && useLocalUrl
    ? `${window.location.origin}/camera/connect?token=${encodeURIComponent(rawToken)}`
    : mobileUrl;

  const copyMobileUrl = () => {
    if (effectiveMobileUrl) {
      navigator.clipboard.writeText(effectiveMobileUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Camera management"
        description="Register webcams, smartphones, recorded video, and IP cameras."
      />

      <ErrorBanner message={error} />

      <section className="surface-grid">
        {kinds.map(({ value, label, icon: Icon }) => (
          <button
            type="button"
            key={value}
            onClick={() => setForm((current) => ({ ...current, kind: value }))}
            className={`card flex items-center gap-3 p-4 text-left hover:border-accent/50 hover:shadow-md ${form.kind === value ? "border-accent ring-2 ring-accent/10" : ""}`}
          >
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent/10"><Icon className="h-5 w-5 text-accent" /></span>
            <span>
              <span className="block text-sm font-semibold">{label}</span>
              <span className="mt-0.5 block text-xs text-muted">{value === "ip" ? "RTSP stream" : value === "video" ? "MP4, AVI or MOV" : "Browser camera"}</span>
            </span>
          </button>
        ))}
      </section>

      <form onSubmit={submit} className="card p-5">
        <h2 className="text-sm font-semibold mb-3">Add new camera source</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <input className="field" placeholder="Camera name (e.g. Entrance Gate 1)" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="field" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {kinds.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
          </select>
          <select className="field" value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })}>
            <option value="">No workplace location</option>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
          {form.kind === "ip" && (
            <input className="field md:col-span-1" placeholder="rtsp://user:password@host/stream" type="url" required value={form.stream_url} onChange={(e) => setForm({ ...form, stream_url: e.target.value })} />
          )}
        </div>
        <button className="btn mt-4" disabled={busy}>{busy ? "Connecting..." : "Add camera"}</button>
      </form>

      {effectiveMobileUrl && (
        <section className="flex flex-col gap-4 rounded border border-accent/30 bg-accent/5 p-5 sm:flex-row sm:items-center">
          <QRCodeCanvas value={effectiveMobileUrl} size={144} includeMargin className="rounded border border-line bg-white shadow-sm" />
          <div className="min-w-0 flex-1 text-sm">
            <div className="flex items-center gap-2">
              <QrCode className="h-4 w-4 text-accent" />
              <h2 className="font-semibold">Mobile camera link {activeCameraName ? `(${activeCameraName})` : ""}</h2>
            </div>
            <p className="mt-1 text-xs text-muted">Scan this QR code with the smartphone browser camera. Link is active for 10 minutes.</p>
            <div className="mt-2.5 flex items-center gap-2">
              <input className="field min-w-0 text-xs" readOnly value={effectiveMobileUrl} />
              <button type="button" className="btn shrink-0 text-xs py-2" onClick={copyMobileUrl}>
                <Copy className="h-3.5 w-3.5 mr-1" />{copied ? "Copied" : "Copy"}
              </button>
              <a href={effectiveMobileUrl} target="_blank" rel="noreferrer" className="rounded border border-line p-2 hover:bg-line/50" title="Open on this device">
                <ExternalLink className="h-4 w-4 text-muted" />
              </a>
            </div>
            <label className="mt-2.5 flex items-center gap-1.5 text-xs text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={useLocalUrl}
                onChange={(e) => setUseLocalUrl(e.target.checked)}
                className="rounded border-line"
              />
              Use current host ({window.location.host}) instead of public URL
            </label>
          </div>
        </section>
      )}

      <div>
        <h2 className="text-sm font-semibold mb-3">Configured cameras ({cameras.length})</h2>
        <section className="grid gap-4 md:grid-cols-2">
          {cameras.map((camera) => (
            <article key={camera.id} className="rounded border border-line bg-surface p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium text-base">{camera.name}</h3>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                    <span className="capitalize font-medium">{camera.kind}</span>
                    <span>·</span>
                    <StatusBadge status={camera.status} />
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {camera.kind === "mobile" && (
                    <button
                      className="rounded border border-line px-2.5 py-1 text-xs font-medium hover:bg-line/50 flex items-center gap-1"
                      onClick={() => showMobileQR(camera)}
                    >
                      <QrCode className="h-3.5 w-3.5 text-accent" />
                      QR Code
                    </button>
                  )}
                  {camera.kind === "webcam" && (
                    <button
                      className="rounded border border-line px-2.5 py-1 text-xs font-medium hover:bg-line/50 flex items-center gap-1"
                      onClick={() => startWebcam(camera.id)}
                    >
                      <MonitorUp className="h-3.5 w-3.5 text-accent" />
                      Test Webcam
                    </button>
                  )}
                  <button className="rounded p-1.5 text-muted hover:bg-line/60 hover:text-bad" onClick={() => remove(camera.id)} aria-label={`Delete ${camera.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </article>
          ))}
          {!cameras.length && <p className="text-sm text-muted">No cameras connected yet.</p>}
        </section>
      </div>

      <section className="rounded border border-line bg-surface p-5">
        <div className="flex items-center gap-2">
          <Video className="h-4 w-4 text-accent" />
          <h2 className="font-medium">Live camera preview</h2>
        </div>
        <video ref={videoRef} autoPlay muted playsInline className="mt-4 aspect-video w-full rounded bg-black object-contain" />
        <button type="button" className="btn mt-4 text-xs py-1.5" onClick={stopPreview}>Stop preview</button>
      </section>
    </div>
  );
}
