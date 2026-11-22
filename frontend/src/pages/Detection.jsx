import { useEffect, useRef, useState } from "react";
import { Film, Image as ImageIcon, Play, Video } from "lucide-react";
import { api } from "../api";

export default function Detection() {
  const [tab, setTab] = useState("image"); // "image" | "video"
  const [status, setStatus] = useState(null);
  const [cameras, setCameras] = useState([]);
  const [cameraId, setCameraId] = useState("");
  const [file, setFile] = useState(null);
  const [videoFile, setVideoFile] = useState(null);
  const [result, setResult] = useState(null);
  const [videoResult, setVideoResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);
  const [imageDims, setImageDims] = useState({ width: 0, height: 0 });
  const [videoDims, setVideoDims] = useState({ width: 0, height: 0 });
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const videoPlayerRef = useRef(null);

  useEffect(() => {
    api("/detection/status").then(setStatus).catch((err) => setError(err.message));
    api("/detection/cameras").then(setCameras).catch((err) => setError(err.message));
  }, []);

  const analyzeImage = async (event) => {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const form = new FormData();
      form.append("image", file);
      if (cameraId) form.append("camera_id", cameraId);
      const response = await api("/detection/analyze-image", { method: "POST", form });
      setResult(response);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const analyzeVideo = async (event) => {
    event.preventDefault();
    if (!videoFile) return;
    setBusy(true);
    setError("");
    setVideoResult(null);
    try {
      const form = new FormData();
      form.append("video", videoFile);
      if (cameraId) form.append("camera_id", cameraId);
      const queued = await api("/detection/analyze-video", { method: "POST", form });
      const deadline = Date.now() + 5 * 60 * 1000;
      let completed = false;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        const job = await api(`/detection/jobs/${queued.job_id}`);
        if (job.status === "completed") {
          setVideoResult(job.result);
          completed = true;
          break;
        }
        if (job.status === "failed") {
          throw new Error(job.error || "Background video analysis failed.");
        }
        setError("");
      }
      if (!completed) throw new Error("Video analysis is still processing; refresh later from the Detection page.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">AI PPE Detection & Video Testing</h1>
          <p className="mt-1 text-sm text-muted">Run detection on still images or recorded test video files with the YOLO PPE engine.</p>
        </div>
        <div className="flex rounded border border-line bg-surface p-1">
          <button
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === "image" ? "bg-accent text-white" : "text-muted hover:text-ink"
            }`}
            onClick={() => setTab("image")}
          >
            <ImageIcon className="h-3.5 w-3.5" /> Still Image
          </button>
          <button
            className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === "video" ? "bg-accent text-white" : "text-muted hover:text-ink"
            }`}
            onClick={() => setTab("video")}
          >
            <Film className="h-3.5 w-3.5" /> Upload Video
          </button>
        </div>
      </div>

      {status && (
        <section className="rounded border border-line bg-surface p-4 text-sm flex items-center justify-between">
          <div className="flex items-center">
            <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${status.configured ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`} />
            <span className="font-medium">Engine status: {status.configured ? "Ready (construction-ppe-yolov8)" : "Model required"}</span>
          </div>
          <span className="text-xs text-muted">
            Confidence threshold: {(status.confidence * 100).toFixed(0)}%
          </span>
        </section>
      )}

      {error && <p role="alert" className="rounded border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{error}</p>}

      {tab === "image" && (
        <>
          <form onSubmit={analyzeImage} className="rounded border border-line bg-surface p-5">
            <h2 className="text-sm font-semibold mb-3">Analyze Image File</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Camera association
                <select className="field mt-2" value={cameraId} onChange={(event) => setCameraId(event.target.value)}>
                  <option value="">Standalone analysis (no database event)</option>
                  {cameras.map((camera) => (
                    <option key={camera.id} value={camera.id}>
                      {camera.name} ({camera.kind}, {camera.status})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Image file (JPEG, PNG, WebP)
                <input
                  className="field mt-2"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => {
                    const selected = event.target.files?.[0] ?? null;
                    setFile(selected);
                    setPreviewUrl(selected ? URL.createObjectURL(selected) : null);
                    setResult(null);
                  }}
                />
              </label>
            </div>
            <button className="btn mt-4" disabled={!file || busy || !status?.configured}>
              {busy ? "Analyzing image..." : "Analyze image"}
            </button>
            {cameraId && <p className="mt-2 text-xs text-muted">This analysis will save detection events and generate alerts for verified missing PPE.</p>}
          </form>

          {previewUrl && (
            <section className="rounded border border-line bg-surface p-5">
              <h2 className="font-medium mb-3">Image & Detection Preview</h2>
              <div className="relative inline-block max-w-full overflow-hidden rounded border border-line">
                <img
                  src={previewUrl}
                  alt="Detection analysis preview"
                  className="max-h-[500px] w-auto object-contain block"
                  onLoad={(e) => {
                    setImageDims({
                      width: e.currentTarget.naturalWidth,
                      height: e.currentTarget.naturalHeight,
                    });
                  }}
                />
                {result?.people?.map((person) => {
                  if (!imageDims.width || !imageDims.height) return null;
                  const [x1, y1, x2, y2] = person.box;
                  const left = `${(x1 / imageDims.width) * 100}%`;
                  const top = `${(y1 / imageDims.height) * 100}%`;
                  const width = `${((x2 - x1) / imageDims.width) * 100}%`;
                  const height = `${((y2 - y1) / imageDims.height) * 100}%`;

                  const borderColor =
                    person.status === "compliant"
                      ? "border-emerald-500 bg-emerald-500/10"
                      : person.status === "non_compliant"
                      ? "border-rose-500 bg-rose-500/10"
                      : "border-amber-500 bg-amber-500/10";
                  const tagColor =
                    person.status === "compliant"
                      ? "bg-emerald-600 text-white"
                      : person.status === "non_compliant"
                      ? "bg-rose-600 text-white"
                      : "bg-amber-600 text-white";

                  return (
                    <div
                      key={person.tracking_id}
                      className={`absolute border-2 pointer-events-none transition-all ${borderColor}`}
                      style={{ left, top, width, height }}
                    >
                      <span className={`absolute -top-6 left-0 text-[11px] font-semibold px-1.5 py-0.5 rounded shadow ${tagColor}`}>
                        #{person.tracking_id} {person.status.replace("_", " ")} ({(person.confidence * 100).toFixed(0)}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {result && (
            <section className="rounded border border-line bg-surface p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-medium">Detection results</h2>
                <span className="text-xs text-muted">
                  {result.violations_created > 0 ? `${result.violations_created} violation(s) recorded` : "No violations recorded"}
                </span>
              </div>
              {!result.people.length && <p className="mt-3 text-sm text-muted">No people detected in this image.</p>}
              <div className="mt-3 space-y-3">
                {result.people.map((person) => (
                  <div key={person.tracking_id} className="rounded border border-line p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Tracking ID #{person.tracking_id}</span>
                      <span className={`font-semibold capitalize px-2 py-0.5 rounded text-xs ${
                        person.status === "compliant" ? "bg-emerald-100 text-emerald-800" : person.status === "non_compliant" ? "bg-rose-100 text-rose-800" : "bg-amber-100 text-amber-800"
                      }`}>
                        {person.status.replace("_", " ")}
                      </span>
                    </div>
                    <p className="mt-1 text-muted text-xs">Person confidence: {(person.confidence * 100).toFixed(1)}%</p>
                    <p className="mt-1 text-muted text-xs">
                      Equipment: {person.equipment.length ? person.equipment.map((item) => `${item.label} (${(item.confidence * 100).toFixed(0)}%)`).join(", ") : "none confidently associated"}
                    </p>
                    <p className={`mt-2 text-xs font-medium ${
                      person.status === "compliant" ? "text-emerald-700" : person.status === "non_compliant" ? "text-rose-700" : "text-amber-700"
                    }`}>
                      {person.compliance_reason}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {tab === "video" && (
        <>
          <form onSubmit={analyzeVideo} className="rounded border border-line bg-surface p-5">
            <h2 className="text-sm font-semibold mb-3">Analyze Recorded Video File</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">
                Camera association
                <select className="field mt-2" value={cameraId} onChange={(event) => setCameraId(event.target.value)}>
                  <option value="">Standalone analysis</option>
                  {cameras.map((camera) => (
                    <option key={camera.id} value={camera.id}>
                      {camera.name} ({camera.kind})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium">
                Video file (MP4, AVI, MOV)
                <input
                  className="field mt-2"
                  type="file"
                  accept="video/mp4,video/avi,video/quicktime,video/x-msvideo"
                  onChange={(event) => {
                    const selected = event.target.files?.[0] ?? null;
                    setVideoFile(selected);
                    setVideoPreviewUrl(selected ? URL.createObjectURL(selected) : null);
                    setVideoResult(null);
                  }}
                />
              </label>
            </div>
            <button className="btn mt-4" disabled={!videoFile || busy || !status?.configured}>
              {busy ? "Processing video frames..." : "Analyze video"}
            </button>
            <p className="mt-2 text-xs text-muted">
              The AI parses frames at 1 fps, identifies workers and PPE equipment, and identifies safety violations throughout the video.
            </p>
          </form>

          {videoPreviewUrl && (
            <section className="rounded border border-line bg-surface p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-medium">Video preview & detection overlays</h2>
                {videoResult && (
                  <span className="text-xs text-muted">
                    Time: {videoCurrentTime.toFixed(1)}s
                  </span>
                )}
              </div>
              <div className="relative aspect-video max-h-[440px] w-full overflow-hidden rounded bg-black">
                <video
                  ref={videoPlayerRef}
                  src={videoPreviewUrl}
                  controls
                  playsInline
                  onTimeUpdate={(e) => setVideoCurrentTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => {
                    setVideoDims({
                      width: e.currentTarget.videoWidth,
                      height: e.currentTarget.videoHeight,
                    });
                  }}
                  className="h-full w-full object-contain block"
                />
                {(() => {
                  if (!videoResult?.timeline?.length || videoDims.width <= 0) return null;
                  const activePoint = videoResult.timeline.reduce((closest, curr) =>
                    Math.abs(curr.timestamp - videoCurrentTime) < Math.abs(closest.timestamp - videoCurrentTime)
                      ? curr
                      : closest
                  );
                  if (Math.abs(activePoint.timestamp - videoCurrentTime) > 1.2) return null;
                  return activePoint.people?.map((person) => {
                    const [x1, y1, x2, y2] = person.box;
                    const left = `${(x1 / videoDims.width) * 100}%`;
                    const top = `${(y1 / videoDims.height) * 100}%`;
                    const width = `${((x2 - x1) / videoDims.width) * 100}%`;
                    const height = `${((y2 - y1) / videoDims.height) * 100}%`;

                    const borderColor =
                      person.status === "compliant"
                        ? "border-emerald-500 bg-emerald-500/10"
                        : person.status === "non_compliant"
                        ? "border-rose-500 bg-rose-500/10"
                        : "border-amber-500 bg-amber-500/10";
                    const tagColor =
                      person.status === "compliant"
                        ? "bg-emerald-600 text-white"
                        : person.status === "non_compliant"
                        ? "bg-rose-600 text-white"
                        : "bg-amber-600 text-white";

                    return (
                      <div
                        key={person.tracking_id}
                        className={`absolute border-2 pointer-events-none transition-all ${borderColor}`}
                        style={{ left, top, width, height }}
                      >
                        <span className={`absolute -top-6 left-0 text-[10px] font-semibold px-1.5 py-0.5 rounded shadow whitespace-nowrap ${tagColor}`}>
                          #{person.tracking_id} {person.status.replace("_", " ")}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            </section>
          )}

          {videoResult && (
            <section className="rounded border border-line bg-surface p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <div>
                  <h2 className="font-semibold text-base">Video analysis summary</h2>
                  <p className="text-xs text-muted mt-0.5">Processed {videoResult.frames_analyzed} sampled seconds · Click any timestamp to jump video playback</p>
                </div>
                <span className="rounded bg-accent/10 text-accent font-semibold text-xs px-2.5 py-1">
                  {videoResult.total_violations} violation(s) detected
                </span>
              </div>

              <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                {videoResult.timeline.map((point) => {
                  const isCurrent = Math.abs(point.timestamp - videoCurrentTime) <= 0.6;
                  return (
                    <button
                      key={point.frame_index}
                      type="button"
                      onClick={() => {
                        if (videoPlayerRef.current) {
                          videoPlayerRef.current.currentTime = point.timestamp;
                          videoPlayerRef.current.play();
                        }
                      }}
                      className={`w-full text-left rounded border p-3 text-xs transition-colors ${
                        isCurrent
                          ? "border-accent bg-accent/10 ring-1 ring-accent"
                          : "border-line bg-surface hover:bg-line/30"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <Play className={`h-3 w-3 ${isCurrent ? "text-accent fill-accent" : "text-muted"}`} />
                          <span className="font-semibold">Time {point.timestamp}s:</span>{" "}
                          <span>{point.person_count} person(s) detected</span>
                          {point.non_compliant_count > 0 && (
                            <span className="font-semibold text-rose-600">
                              ({point.non_compliant_count} violation)
                            </span>
                          )}
                        </div>
                        <div className="flex gap-2 text-[11px]">
                          <span className="text-emerald-600 font-medium">{point.compliant_count} compliant</span>
                          <span>·</span>
                          <span className="text-rose-600 font-medium">{point.non_compliant_count} non-compliant</span>
                        </div>
                      </div>
                      {point.people?.length > 0 && (
                        <div className="mt-2 space-y-1 border-t border-line/60 pt-2">
                          {point.people.map((person) => (
                            <div key={person.tracking_id} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                              <span className="font-medium">Worker #{person.tracking_id}:</span>
                              <span className={person.status === "compliant" ? "text-emerald-700" : person.status === "non_compliant" ? "text-rose-700" : "text-amber-700"}>
                                {person.compliance_reason}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
