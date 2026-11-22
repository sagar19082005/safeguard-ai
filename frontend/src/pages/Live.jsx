import { useEffect, useRef, useState } from "react";
import { Camera, CircleStop, Copy, ExternalLink, Play, RefreshCw, Volume2, VolumeX } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { api, token } from "../api";

function statusStyle(status) {
  if (status === "compliant") return "border-emerald-500 bg-emerald-500/10";
  if (status === "non_compliant") return "border-rose-500 bg-rose-500/10";
  return "border-amber-500 bg-amber-500/10";
}

const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

// Simple Web Audio alert chime for PPE violations
function playViolationAlarm() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.35);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch {
    // Audio context may be restricted before user interaction
  }
}

function LiveCameraCard({ camera, detectionReady, soundEnabled, zones = [] }) {
  const cameraZones = zones.filter((z) => z.camera_id === camera.id);
  const videoRef = useRef(null);
  const canvasRef = useRef(document.createElement("canvas"));
  const peerRef = useRef(null);
  const signalRef = useRef(null);
  const detectionRef = useRef(null);
  const frameTimerRef = useRef(null);
  const lastAlarmRef = useRef(0);

  const [state, setState] = useState("offline");
  const [error, setError] = useState("");
  const [people, setPeople] = useState([]);
  const [summary, setSummary] = useState({ person_count: 0, compliant_count: 0, non_compliant_count: 0, uncertain_count: 0 });
  const [connectionUrl, setConnectionUrl] = useState("");
  const [useLocalUrl, setUseLocalUrl] = useState(false);
  const [rawToken, setRawToken] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => () => stop(), []);

  const stop = () => {
    if (frameTimerRef.current) window.clearInterval(frameTimerRef.current);
    detectionRef.current?.close();
    peerRef.current?.close();
    signalRef.current?.close();
    videoRef.current?.srcObject?.getTracks().forEach((track) => track.stop());
    frameTimerRef.current = null;
    detectionRef.current = null;
    peerRef.current = null;
    signalRef.current = null;
    setState("offline");
    api(`/cameras/${camera.id}/status`, { method: "PATCH", body: { status: "offline" } }).catch(() => {});
  };

  const connectDetection = async () => {
    if (!detectionReady || !videoRef.current) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/detection/stream/${camera.id}?token=${encodeURIComponent(token.get())}`);
    socket.onopen = () => {
      setState("online");
      api(`/cameras/${camera.id}/status`, { method: "PATCH", body: { status: "online" } }).catch(() => {});
      frameTimerRef.current = window.setInterval(sendFrame, 1000);
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "detection") {
        setPeople(message.people);
        setSummary(message);

        // Trigger audible alarm on non-compliant detection
        if (soundEnabled && message.violation_detected) {
          const now = Date.now();
          if (now - lastAlarmRef.current > 4000) {
            lastAlarmRef.current = now;
            playViolationAlarm();
          }
        }
      } else if (message.type === "error") {
        setError(message.message);
      }
    };
    socket.onerror = () => setError("Live detection connection failed.");
    detectionRef.current = socket;
  };

  const sendFrame = () => {
    const video = videoRef.current;
    const socket = detectionRef.current;
    if (!video || !socket || socket.readyState !== WebSocket.OPEN || video.readyState < 2 || !video.videoWidth) return;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob && socket.readyState === WebSocket.OPEN) socket.send(blob);
    }, "image/jpeg", 0.65);
  };

  const start = async () => {
    setError("");
    setPeople([]);
    setSummary({ person_count: 0, compliant_count: 0, non_compliant_count: 0, uncertain_count: 0 });
    stop();
    if (!detectionReady) {
      setError("Configure a trained PPE model before starting live detection.");
      return;
    }
    try {
      if (camera.kind === "webcam") {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        await connectDetection();
      } else if (camera.kind === "mobile") {
        const result = await api(`/cameras/${camera.id}/mobile-token`, { method: "POST" });
        setRawToken(result.token);
        setConnectionUrl(result.connection_url);
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const socket = new WebSocket(`${protocol}//${window.location.host}/api/cameras/signal/${result.token}`);
        const peer = new RTCPeerConnection(rtcConfig);
        const pendingIce = [];
        peer.ontrack = async (event) => {
          videoRef.current.srcObject = event.streams[0];
          await videoRef.current.play();
          await connectDetection();
        };
        socket.onmessage = async (event) => {
          const message = JSON.parse(event.data);
          if (message.type === "offer") {
            await peer.setRemoteDescription(message);
            for (const candidate of pendingIce.splice(0)) await peer.addIceCandidate(candidate);
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            socket.send(JSON.stringify({ type: "answer", sdp: answer.sdp }));
          } else if (message.type === "ice" && message.candidate) {
            if (peer.remoteDescription) await peer.addIceCandidate(message.candidate);
            else pendingIce.push(message.candidate);
          }
        };
        peer.onicecandidate = (event) => {
          if (event.candidate && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ice", candidate: event.candidate }));
        };
        peerRef.current = peer;
        signalRef.current = socket;
        peer.onconnectionstatechange = () => {
          if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
            setState("error");
            setError("Phone connected to signaling, but video transmission failed. Retry connection.");
          }
        };
        setState("connecting");
      } else {
        setError("This camera type does not support browser streaming directly.");
      }
    } catch (err) {
      setError(err.message || "Unable to start this camera.");
      setState("error");
    }
  };

  const activeUrl = rawToken && useLocalUrl
    ? `${window.location.origin}/camera/connect?token=${encodeURIComponent(rawToken)}`
    : connectionUrl;

  const copyUrl = () => {
    if (activeUrl) {
      navigator.clipboard.writeText(activeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <article className="overflow-hidden rounded border border-line bg-surface shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-line p-4">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-accent" />
          <div>
            <h2 className="font-medium">{camera.name}</h2>
            <p className="text-xs capitalize text-muted">
              {camera.kind} · <span className={state === "online" ? "font-medium text-emerald-600" : state === "connecting" ? "font-medium text-amber-500" : "text-muted"}>{state}</span>
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn px-3 py-1.5" onClick={start} disabled={state === "connecting"}>
            <Play className="mr-1 h-3.5 w-3.5" />Start
          </button>
          <button className="rounded border border-line px-3 py-1.5 text-sm hover:bg-line/50" onClick={stop}>
            <CircleStop className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="relative aspect-video bg-black">
        <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-contain" />
        {people.map((person) => {
          const video = videoRef.current;
          if (!video?.videoWidth) return null;
          const [x1, y1, x2, y2] = person.box;
          return (
            <div
              key={person.tracking_id}
              className={`pointer-events-none absolute border-2 transition-all ${statusStyle(person.status)}`}
              style={{
                left: `${(x1 / video.videoWidth) * 100}%`,
                top: `${(y1 / video.videoHeight) * 100}%`,
                width: `${((x2 - x1) / video.videoWidth) * 100}%`,
                height: `${((y2 - y1) / video.videoHeight) * 100}%`,
              }}
            >
              <span className={`absolute -top-6 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold text-white shadow ${
                person.status === "compliant" ? "bg-emerald-600" : person.status === "non_compliant" ? "bg-rose-600" : "bg-amber-600"
              }`}>
                #{person.tracking_id} {person.status.replace("_", " ")}
              </span>
            </div>
          );
        })}
        {!videoRef.current?.srcObject && (
          <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-white/70">
            {state === "connecting" ? "Waiting for phone connection. Scan the QR code below." : "Camera feed stopped"}
          </p>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2 p-4 text-center text-xs border-b border-line">
        <div>
          <p className="text-lg font-semibold">{summary.person_count}</p>
          <p className="text-muted">People</p>
        </div>
        <div className="text-emerald-600">
          <p className="text-lg font-semibold">{summary.compliant_count}</p>
          <p>Compliant</p>
        </div>
        <div className="text-rose-600">
          <p className="text-lg font-semibold">{summary.non_compliant_count}</p>
          <p>Violation</p>
        </div>
        <div className="text-amber-600">
          <p className="text-lg font-semibold">{summary.uncertain_count}</p>
          <p>Review</p>
        </div>
      </div>

      {activeUrl && camera.kind === "mobile" && state === "connecting" && (
        <div className="flex flex-col sm:flex-row items-center gap-4 p-4 border-b border-line bg-surface/50">
          <QRCodeCanvas value={activeUrl} size={110} includeMargin className="rounded border border-line bg-white" />
          <div className="min-w-0 flex-1 text-xs">
            <p className="font-medium text-ink">Connect phone camera</p>
            <p className="text-muted mt-0.5">Scan this QR code with the smartphone camera.</p>
            <div className="mt-2 flex items-center gap-2">
              <input className="field py-1 text-xs min-w-0" readOnly value={activeUrl} />
              <button className="btn px-2.5 py-1 text-xs shrink-0" onClick={copyUrl}>
                <Copy className="h-3 w-3 mr-1" />{copied ? "Copied" : "Copy"}
              </button>
              <a href={activeUrl} target="_blank" rel="noreferrer" className="rounded border border-line p-1 hover:bg-line/50" title="Open test window">
                <ExternalLink className="h-3.5 w-3.5 text-muted" />
              </a>
            </div>
            <div className="mt-2 flex items-center gap-3 text-[11px] text-muted">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useLocalUrl}
                  onChange={(e) => setUseLocalUrl(e.target.checked)}
                  className="rounded border-line"
                />
                Use current host ({window.location.host}) instead of public URL
              </label>
            </div>
          </div>
        </div>
      )}

      {error && <p role="alert" className="border-t border-bad/30 bg-bad/10 p-3 text-xs text-bad">{error}</p>}
    </article>
  );
}

export default function Live() {
  const [cameras, setCameras] = useState([]);
  const [detection, setDetection] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [error, setError] = useState("");

  const load = () => {
    Promise.all([api("/cameras"), api("/detection/status")])
      .then(([cameraList, status]) => {
        setCameras(cameraList);
        setDetection(status);
      })
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Live monitoring</h1>
          <p className="mt-1 text-sm text-muted">Monitor browser webcams and mobile phones with real-time AI PPE detection.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSoundEnabled((prev) => !prev)}
            className={`flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium transition-colors ${
              soundEnabled ? "border-accent/40 bg-accent/10 text-accent" : "border-line bg-surface text-muted"
            }`}
            title={soundEnabled ? "Audible alert alarm is ON" : "Audible alert alarm is MUTED"}
          >
            {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            {soundEnabled ? "Alarm ON" : "Alarm Muted"}
          </button>
          <button className="rounded border border-line p-2 text-muted hover:bg-line/50" onClick={load} aria-label="Refresh cameras">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && <p role="alert" className="rounded border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{error}</p>}

      {detection && (
        <div className="rounded border border-line bg-surface p-4 text-sm flex items-center justify-between">
          <div className="flex items-center">
            <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${detection.configured ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`} />
            <span>{detection.configured ? "YOLO PPE Detection Engine active" : "Configure PPE_MODEL_PATH before starting live detection."}</span>
          </div>
          <span className="text-xs text-muted">Confidence: {(detection.confidence * 100).toFixed(0)}%</span>
        </div>
      )}

      {!cameras.length && (
        <div className="rounded border border-dashed border-line p-8 text-center text-sm text-muted">
          No cameras added yet. Go to <a href="/cameras" className="text-accent underline font-medium">Camera Management</a> to add a laptop webcam or mobile camera.
        </div>
      )}

      <section className="grid gap-6 xl:grid-cols-2">
        {cameras.map((camera) => (
          <LiveCameraCard
            key={camera.id}
            camera={camera}
            detectionReady={Boolean(detection?.configured)}
            soundEnabled={soundEnabled}
          />
        ))}
      </section>
    </div>
  );
}
