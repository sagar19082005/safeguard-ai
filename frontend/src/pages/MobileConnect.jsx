import { useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, SwitchCamera } from "lucide-react";

export default function MobileConnect() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const peerRef = useRef(null);
  const socketRef = useRef(null);
  const [status, setStatus] = useState("Ready to connect");
  const [error, setError] = useState("");
  const [facingMode, setFacingMode] = useState("environment"); // "environment" | "user"
  const [streaming, setStreaming] = useState(false);
  const token = new URLSearchParams(window.location.search).get("token");
  const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    peerRef.current?.close();
    socketRef.current?.close();
  }, []);

  const startStream = async (mode = facingMode) => {
    if (!token) {
      setError("This camera link is missing its connection token.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access is not supported or requires a secure context (HTTPS / localhost).");
      return;
    }
    setError("");

    // Stop existing tracks
    streamRef.current?.getTracks().forEach((t) => t.stop());
    peerRef.current?.close();
    socketRef.current?.close();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode } },
        audio: false,
      });
      videoRef.current.srcObject = stream;
      streamRef.current = stream;

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/cameras/signal/${token}`);
      const peer = new RTCPeerConnection(rtcConfig);
      const pendingIce = [];

      stream.getTracks().forEach((track) => peer.addTrack(track, stream));

      socket.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "peer_joined") {
          try {
            const offer = await peer.createOffer({ iceRestart: true });
            await peer.setLocalDescription(offer);
            socket.send(JSON.stringify({ type: "offer", sdp: offer.sdp }));
          } catch (e) {
            console.error("Failed to re-negotiate on peer_joined", e);
          }
        }
        if (message.type === "answer") {
          await peer.setRemoteDescription(message);
          for (const candidate of pendingIce.splice(0)) await peer.addIceCandidate(candidate);
        }
        if (message.type === "ice" && message.candidate) {
          if (peer.remoteDescription) await peer.addIceCandidate(message.candidate);
          else pendingIce.push(message.candidate);
        }
      };

      socket.onopen = async () => {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        socket.send(JSON.stringify({ type: "offer", sdp: offer.sdp }));
        setStatus("Streaming live to SafeGuard AI dashboard");
        setStreaming(true);
      };

      peer.onicecandidate = (event) => {
        if (event.candidate && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ice", candidate: event.candidate }));
        }
      };

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") {
          setStatus("Connected & streaming live video");
        } else if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
          setStatus("Disconnected. Tap Reconnect to try again.");
          setStreaming(false);
        }
      };

      socketRef.current = socket;
      peerRef.current = peer;
      setStatus("Connecting to SafeGuard AI...");
    } catch (err) {
      setError(err.message || "Camera permission was denied or camera is in use.");
      setStreaming(false);
    }
  };

  const toggleCamera = async () => {
    const nextMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(nextMode);
    if (streaming) {
      await startStream(nextMode);
    }
  };

  const stop = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    peerRef.current?.close();
    socketRef.current?.close();
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus("Camera stopped");
    setStreaming(false);
  };

  return (
    <main className="min-h-screen bg-bg p-4 sm:p-6 text-ink flex flex-col justify-center">
      <div className="mx-auto w-full max-w-md space-y-4 rounded-xl border border-line bg-surface p-5 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-accent" />
            <h1 className="text-lg font-semibold">SafeGuard AI Mobile Camera</h1>
          </div>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
            streaming ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/30" : "bg-line/50 text-muted"
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${streaming ? "bg-emerald-500 animate-pulse" : "bg-muted"}`} />
            {streaming ? "Live" : "Idle"}
          </span>
        </div>

        <p className="text-xs text-muted">
          Stream live smartphone video to the SafeGuard AI platform for real-time PPE compliance detection.
        </p>

        <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
          <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-contain" />
          {!streaming && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-white/60">
              Camera is inactive
            </div>
          )}
        </div>

        <div className="rounded border border-line bg-surface/50 p-3 text-xs flex items-center justify-between">
          <span className="font-medium">{status}</span>
          <span className="text-muted capitalize">Facing: {facingMode === "environment" ? "Rear" : "Front"}</span>
        </div>

        {error && (
          <p role="alert" className="rounded border border-bad/40 bg-bad/10 p-3 text-xs text-bad">
            {error}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          {!streaming ? (
            <button className="btn py-2 text-sm col-span-2" onClick={() => startStream()}>
              Start live camera
            </button>
          ) : (
            <>
              <button className="btn py-2 text-sm bg-rose-600 hover:bg-rose-700" onClick={stop}>
                Stop camera
              </button>
              <button className="rounded border border-line py-2 text-xs font-medium hover:bg-line/50 flex items-center justify-center gap-1" onClick={toggleCamera}>
                <SwitchCamera className="h-4 w-4" /> Switch ({facingMode === "environment" ? "Front" : "Rear"})
              </button>
            </>
          )}
        </div>

        <div className="text-center pt-2">
          <p className="text-[11px] text-muted">
            Tip: Keep this browser tab open while monitoring is in progress.
          </p>
        </div>
      </div>
    </main>
  );
}
