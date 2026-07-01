// Lightweight API client for the RafineAI management api.
// Base URL: NEXT_PUBLIC_API_URL (empty => same origin, proxied by nginx).

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

const ACCESS = "rafine_access";
const REFRESH = "rafine_refresh";
const ROLE = "rafine_role";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACCESS);
}

export function getRole(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ROLE);
}

export function setSession(access: string, refresh: string, role: string) {
  window.localStorage.setItem(ACCESS, access);
  window.localStorage.setItem(REFRESH, refresh);
  window.localStorage.setItem(ROLE, role);
}

export function clearSession() {
  window.localStorage.removeItem(ACCESS);
  window.localStorage.removeItem(REFRESH);
  window.localStorage.removeItem(ROLE);
}

async function tryRefresh(): Promise<boolean> {
  const refresh = window.localStorage.getItem(REFRESH);
  if (!refresh) return false;
  const res = await fetch(`${BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  setSession(data.access_token, data.refresh_token, data.role);
  return true;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(
  path: string,
  opts: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers = new Headers(opts.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  // Don't set Content-Type for FormData — the browser sets the multipart boundary.
  const isFormData = typeof FormData !== "undefined" && opts.body instanceof FormData;
  if (opts.body && !isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });

  if (res.status === 401 && retry && (await tryRefresh())) {
    return api<T>(path, opts, false);
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = body.detail ?? body.error?.message ?? msg;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/**
 * Stream a chat reply. POSTs to the streaming endpoint and invokes onDelta for
 * each token as it arrives. Error chunks (policy blocks, gateway errors) are
 * delivered via onError so the UI can display them differently.
 * Resolves when the stream ends.
 */
export async function streamChat(
  conversationId: string,
  content: string,
  onDelta: (text: string) => void,
  onError?: (msg: string) => void,
): Promise<void> {
  const headers = new Headers({ "Content-Type": "application/json" });
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${BASE}/api/conversations/${conversationId}/chat/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ content }),
  });
  if (!res.ok || !res.body) {
    throw new ApiError(res.status, "stream failed");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const evt of events) {
      const line = evt.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice("data:".length).trim();
      if (payload === "[DONE]") return;
      try {
        const chunk = JSON.parse(payload);
        const piece = chunk.choices?.[0]?.delta?.content;
        if (!piece) continue;
        if (chunk.error) {
          onError ? onError(piece) : onDelta(piece);
        } else {
          onDelta(piece);
        }
      } catch {
        /* ignore partial/non-JSON keepalives */
      }
    }
  }
}

/** Upload a file (multipart/form-data). Handles auth automatically. */
export async function uploadFile<T = unknown>(path: string, formData: FormData, retry = true): Promise<T> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers, body: formData });
  if (res.status === 401 && retry && (await tryRefresh())) {
    return uploadFile<T>(path, formData, false);
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { const b = await res.json(); msg = b.detail ?? msg; } catch {}
    throw new ApiError(res.status, typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return res.json() as Promise<T>;
}

/**
 * Fetch a protected binary endpoint with the auth header and return an
 * object URL the browser can render (img/iframe src). Caller must revoke it.
 */
export async function authedBlobUrl(path: string): Promise<string> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${BASE}${path}`, { headers });
  if (!res.ok) throw new ApiError(res.status, "içerik yüklenemedi");
  return URL.createObjectURL(await res.blob());
}

export async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new ApiError(res.status, "Invalid credentials");
  const data = await res.json();
  setSession(data.access_token, data.refresh_token, data.role);
  return data;
}
