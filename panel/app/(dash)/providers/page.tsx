"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Provider } from "@/lib/types";

const TYPES = ["openai", "anthropic", "gemini"];

export default function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    type: "openai",
    auth_mode: "api_key",
    api_key: "",
    oauth_client_id: "",
    oauth_client_secret: "",
    oauth_auth_url: "",
    oauth_token_url: "",
    oauth_scopes: "",
    base_url: "",
    default_model: "",
  });

  async function refresh() {
    setProviders(await api<Provider[]>("/api/providers"));
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const payload: Record<string, unknown> = {
      name: form.name,
      type: form.type,
      auth_mode: form.auth_mode,
      default_model: form.default_model,
    };
    if (form.base_url) payload.base_url = form.base_url;
    if (form.auth_mode === "api_key") {
      payload.api_key = form.api_key;
    } else {
      payload.oauth_client_id = form.oauth_client_id;
      payload.oauth_client_secret = form.oauth_client_secret;
      payload.oauth_auth_url = form.oauth_auth_url;
      payload.oauth_token_url = form.oauth_token_url;
      payload.oauth_scopes = form.oauth_scopes;
    }
    try {
      await api("/api/providers", { method: "POST", body: JSON.stringify(payload) });
      setForm({ ...form, name: "", api_key: "", default_model: "" });
      refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function remove(p: Provider) {
    if (!confirm(`Delete ${p.name}?`)) return;
    await api(`/api/providers/${p.id}`, { method: "DELETE" });
    refresh();
  }

  async function connect(p: Provider) {
    const { auth_url } = await api<{ auth_url: string }>(
      `/api/providers/${p.id}/oauth/start`,
    );
    window.location.href = auth_url;
  }

  return (
    <div className="h-screen overflow-y-auto p-8">
      <h1 className="mb-6 text-2xl font-bold">LLM Providers</h1>

      <form onSubmit={create} className="card mb-8 space-y-4 p-5">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Name">
            <input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </Field>
          <Field label="Default model">
            <input
              className="input"
              placeholder="e.g. gpt-4o"
              value={form.default_model}
              onChange={(e) => set("default_model", e.target.value)}
              required
            />
          </Field>
          <Field label="Type">
            <select className="input" value={form.type} onChange={(e) => set("type", e.target.value)}>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Auth mode">
            <select
              className="input"
              value={form.auth_mode}
              onChange={(e) => set("auth_mode", e.target.value)}
            >
              <option value="api_key">Shared API key</option>
              <option value="oauth2">Per-user OAuth2</option>
            </select>
          </Field>
        </div>

        {form.auth_mode === "api_key" ? (
          <Field label="API key">
            <input
              className="input"
              type="password"
              value={form.api_key}
              onChange={(e) => set("api_key", e.target.value)}
              required
            />
          </Field>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Field label="OAuth client ID">
              <input className="input" value={form.oauth_client_id} onChange={(e) => set("oauth_client_id", e.target.value)} />
            </Field>
            <Field label="OAuth client secret">
              <input className="input" type="password" value={form.oauth_client_secret} onChange={(e) => set("oauth_client_secret", e.target.value)} />
            </Field>
            <Field label="Authorize URL">
              <input className="input" value={form.oauth_auth_url} onChange={(e) => set("oauth_auth_url", e.target.value)} />
            </Field>
            <Field label="Token URL">
              <input className="input" value={form.oauth_token_url} onChange={(e) => set("oauth_token_url", e.target.value)} />
            </Field>
            <Field label="Scopes">
              <input className="input" value={form.oauth_scopes} onChange={(e) => set("oauth_scopes", e.target.value)} />
            </Field>
          </div>
        )}

        <Field label="Base URL (optional)">
          <input className="input" value={form.base_url} onChange={(e) => set("base_url", e.target.value)} />
        </Field>

        <button className="btn" type="submit">
          Add provider
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="space-y-3">
        {providers.map((p) => (
          <div key={p.id} className="card flex items-center justify-between p-4">
            <div>
              <p className="font-medium">
                {p.name}{" "}
                <span className="text-xs text-slate-400">
                  ({p.type} · {p.default_model} · {p.auth_mode})
                </span>
              </p>
              <p className="text-xs text-slate-500">
                {p.auth_mode === "api_key"
                  ? p.has_api_key
                    ? "API key configured"
                    : "no API key"
                  : p.connected
                    ? "connected"
                    : "not connected"}
                {p.is_active ? "" : " · disabled"}
              </p>
            </div>
            <div className="flex gap-2">
              {p.auth_mode === "oauth2" && !p.connected && (
                <button className="btn" onClick={() => connect(p)}>
                  Connect
                </button>
              )}
              <button className="btn-ghost" onClick={() => remove(p)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
