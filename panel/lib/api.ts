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
  if (opts.body && !headers.has("Content-Type")) {
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
