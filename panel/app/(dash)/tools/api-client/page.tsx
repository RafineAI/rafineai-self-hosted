"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

interface ApiResponse { status: number; headers: Record<string, string>; body: string; time_ms: number; size_bytes: number }
interface Saved { id: string; name: string; method: string; url: string; headers: Record<string, string>; body: string }

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export default function ApiClientPage() {
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [body, setBody] = useState("");
  const [resp, setResp] = useState<ApiResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [explanation, setExplanation] = useState("");
  const [explaining, setExplaining] = useState(false);

  async function refreshSaved() {
    setSaved(await api<Saved[]>("/api/tools/api-client/requests"));
  }
  useEffect(() => { refreshSaved().catch(() => {}); }, []);

  function parseHeaders(): Record<string, string> {
    const h: Record<string, string> = {};
    headersText.split("\n").forEach((line) => {
      const idx = line.indexOf(":");
      if (idx > 0) h[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });
    return h;
  }

  async function send() {
    setLoading(true); setError(""); setResp(null); setExplanation("");
    try {
      const r = await api<ApiResponse>("/api/tools/api-client/send", {
        method: "POST",
        body: JSON.stringify({ method, url, headers: parseHeaders(), body }),
      });
      setResp(r);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    const name = prompt("İstek adı:", `${method} ${url}`);
    if (!name) return;
    await api("/api/tools/api-client/requests", {
      method: "POST",
      body: JSON.stringify({ name, method, url, headers: parseHeaders(), body }),
    });
    await refreshSaved();
  }

  function load(s: Saved) {
    setMethod(s.method); setUrl(s.url); setBody(s.body || "");
    setHeadersText(Object.entries(s.headers || {}).map(([k, v]) => `${k}: ${v}`).join("\n"));
    setResp(null); setExplanation("");
  }

  async function del(s: Saved) {
    await api(`/api/tools/api-client/requests/${s.id}`, { method: "DELETE" });
    await refreshSaved();
  }

  async function explain() {
    if (!resp) return;
    setExplaining(true); setExplanation("");
    try {
      const r = await api<{ explanation: string }>("/api/tools/api-client/explain", {
        method: "POST",
        body: JSON.stringify({
          request: { method, url, headers: parseHeaders(), body },
          response: { status: resp.status, body: resp.body },
        }),
      });
      setExplanation(r.explanation);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setExplaining(false);
    }
  }

  const statusColor = resp && resp.status < 400 ? "text-green-600" : "text-red-600";

  return (
    <div className="flex h-screen">
      {/* Saved requests */}
      <div className="flex w-64 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <Link href="/marketplace" className="text-xs text-slate-400">← Marketplace</Link>
          <h2 className="mt-1 font-semibold">🛰️ API Client</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          <p className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Kayıtlı</p>
          {saved.map((s) => (
            <div key={s.id} className="group flex items-center border-b border-slate-100 px-3 py-2 hover:bg-slate-50">
              <button className="flex-1 truncate text-left text-sm" onClick={() => load(s)}>
                <span className="font-mono text-xs text-brand">{s.method}</span> {s.name}
              </button>
              <button className="text-xs text-red-500 opacity-0 group-hover:opacity-100" onClick={() => del(s)}>sil</button>
            </div>
          ))}
          {saved.length === 0 && <p className="p-4 text-sm text-slate-400">Kayıtlı istek yok.</p>}
        </div>
      </div>

      {/* Composer + response */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="space-y-2 border-b border-slate-200 bg-white p-4">
          <div className="flex gap-2">
            <select className="input max-w-[120px]" value={method} onChange={(e) => setMethod(e.target.value)}>
              {METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
            <input className="input flex-1" placeholder="https://api.example.com/v1/..." value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn" onClick={send} disabled={loading || !url}>{loading ? "…" : "Gönder"}</button>
            <button className="btn-ghost" onClick={save} disabled={!url}>Kaydet</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <textarea className="input h-20 resize-none font-mono text-xs" placeholder="Başlıklar (her satır: Key: Value)" value={headersText} onChange={(e) => setHeadersText(e.target.value)} />
            <textarea className="input h-20 resize-none font-mono text-xs" placeholder="İstek gövdesi (JSON vb.)" value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
        </div>

        {error && <p className="px-4 py-2 text-sm text-red-600">{error}</p>}

        <div className="flex-1 overflow-y-auto p-4">
          {resp && (
            <>
              <div className="mb-3 flex items-center gap-4 text-sm">
                <span className={`font-bold ${statusColor}`}>HTTP {resp.status}</span>
                <span className="text-slate-500">{resp.time_ms} ms</span>
                <span className="text-slate-500">{(resp.size_bytes / 1024).toFixed(1)} KB</span>
                <button className="btn-ghost ml-auto text-sm" onClick={explain} disabled={explaining}>
                  {explaining ? "LLM düşünüyor…" : "🤖 LLM'e sor"}
                </button>
              </div>
              {explanation && (
                <div className="card mb-3 whitespace-pre-wrap p-4 text-sm text-slate-700">{explanation}</div>
              )}
              <pre className="overflow-auto rounded-lg bg-slate-50 p-4 text-xs text-slate-800">{resp.body}</pre>
            </>
          )}
          {!resp && !loading && <p className="text-sm text-slate-400">İstek gönderin, yanıt burada görünecek.</p>}
        </div>
      </div>
    </div>
  );
}
