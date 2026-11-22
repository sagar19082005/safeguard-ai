const KEY = "sg_token";
export const token = {
  get: () => localStorage.getItem(KEY),
  set: (value) => localStorage.setItem(KEY, value),
  clear: () => localStorage.removeItem(KEY),
};

export function evidenceUrl(path) {
  if (!path) return path;
  const accessToken = token.get();
  if (!accessToken || !path.startsWith("/evidence/")) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}token=${encodeURIComponent(accessToken)}`;
}

export async function api(path, { method = "GET", body, form } = {}) {
  const headers = {};
  const accessToken = token.get();
  if (accessToken) headers.Authorization = "Bearer " + accessToken;
  if (body) headers["Content-Type"] = "application/json";

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  if (res.status === 401 && token.get()) {
    token.clear();
    window.location.assign("/login");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data.detail;
    throw new Error(
      typeof d === "string"
        ? d
        : Array.isArray(d)
          ? d.map((e) => e.msg).join(". ")
          : "Request failed.",
    );
  }
  return data;
}
