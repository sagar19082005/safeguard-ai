import { AlertCircle, RefreshCw } from "lucide-react";

export function PageHeader({ title, description, action }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorBanner({ message }) {
  if (!message) return null;
  return (
    <div role="alert" className="error-banner">
      <AlertCircle className="h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

export function LoadingPanel({ label = "Loading..." }) {
  return (
    <div className="loading-panel" role="status" aria-live="polite">
      <RefreshCw className="h-5 w-5 animate-spin text-accent" />
      <span>{label}</span>
    </div>
  );
}

export function StatusBadge({ status = "offline" }) {
  const normalized = String(status).toLowerCase();
  const tone = ["online", "active", "resolved", "compliant"].includes(normalized)
    ? "status-ok"
    : ["error", "offline", "inactive", "rejected"].includes(normalized)
      ? "status-error"
      : "status-neutral";
  return (
    <span className={`status-badge ${tone}`}>
      <span className="status-dot" />
      {normalized.replace("_", " ")}
    </span>
  );
}
