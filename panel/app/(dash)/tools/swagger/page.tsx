"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

interface Endpoint { method: string; path: string; summary: string }

const METHOD_COLORS: Record<string, string> = {
  GET: "text-sky-600", POST: "text-green-600", PUT: "text-amber-600",
  PATCH: "text-amber-600", DELETE: "text-red-600",
};

export default function SwaggerToolPage() {
  const router = useRouter();
  const [specUrl, setSpecUrl] = useState("");
  const [specText, setSpecText] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  function parseSpec(raw: string) {
    setError("");
    let spec: any;
    try { spec = JSON.parse(raw); }
    catch { setError("Geçersiz JSON. (YAML desteklenmez — JSON yapıştırın veya URL kullanın.)"); return; }
    setTitle(spec.info?.title || "OpenAPI");
    const servers = spec.servers?.[0]?.url || "";
    setBaseUrl(servers);
    const eps: Endpoint[] = [];
    for (const [path, methods] of Object.entries<any>(spec.paths || {})) {
      for (const [method, op] of Object.entries<any>(methods)) {
        if (["get", "post", "put", "patch", "delete"].includes(method)) {
          eps.push({ method: method.toUpperCase(), path, summary: op.summary || op.operationId || "" });
        }
      }
    }
    setEndpoints(eps);
  }

  async function loadFromUrl() {
    setError("");
    try {
      // Use the server-side API Client proxy to avoid browser CORS.
      const r = await api<{ body: string }>("/api/tools/api-client/send", {
        method: "POST",
        body: JSON.stringify({ method: "GET", url: specUrl, headers: {} }),
      });
      setSpecText(r.body);
      parseSpec(r.body);
    } catch (e: any) {
      setError(e.message);
    }
  }

  function sendToApiClient(ep: Endpoint) {
    const url = (baseUrl || "") + ep.path;
    localStorage.setItem("rafine_apiclient_prefill", JSON.stringify({ method: ep.method, url }));
    router.push("/tools/api-client");
  }

  return (
    <div className="h-screen overflow-y-auto p-8">
      <Link href="/marketplace" className="text-xs text-slate-400">← Marketplace</Link>
      <h1 className="page-title mb-1 mt-1">📘 Swagger / OpenAPI</h1>
      <p className="mb-6 text-sm text-slate-500">
        OpenAPI tanımını URL'den yükleyin veya JSON yapıştırın. Endpoint'leri API Client'a aktarın.
      </p>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="card mb-6 space-y-3 p-5">
        <div className="flex gap-2">
          <input className="input flex-1" placeholder="https://.../openapi.json" value={specUrl} onChange={(e) => setSpecUrl(e.target.value)} />
          <button className="btn" onClick={loadFromUrl} disabled={!specUrl}>URL'den yükle</button>
        </div>
        <textarea className="input h-32 resize-none font-mono text-xs" placeholder="…veya OpenAPI JSON yapıştırın" value={specText}
          onChange={(e) => setSpecText(e.target.value)} />
        <button className="btn-ghost" onClick={() => parseSpec(specText)} disabled={!specText}>JSON'u çözümle</button>
      </div>

      {endpoints.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-medium">
            {title} — {endpoints.length} endpoint {baseUrl && <span className="text-slate-400">· {baseUrl}</span>}
          </div>
          {endpoints.map((ep, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-slate-100 px-4 py-2.5 hover:bg-slate-50">
              <span className={`w-16 shrink-0 font-mono text-xs font-bold ${METHOD_COLORS[ep.method] || "text-slate-600"}`}>{ep.method}</span>
              <span className="flex-1 truncate font-mono text-sm">{ep.path}</span>
              <span className="hidden truncate text-xs text-slate-400 md:block md:max-w-xs">{ep.summary}</span>
              <button className="btn-ghost text-xs" onClick={() => sendToApiClient(ep)}>API Client'a aktar</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
