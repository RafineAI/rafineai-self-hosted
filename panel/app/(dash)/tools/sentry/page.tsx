"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

interface Project { slug: string; name: string }
interface Issue { id: string; title: string; culprit: string; level: string; count: string; last_seen: string; permalink: string }
interface Explanation { issue_id: string; title: string; permalink: string; answer: string }

const LEVEL: Record<string, string> = {
  error: "bg-red-100 text-red-700",
  warning: "bg-amber-100 text-amber-700",
  info: "bg-sky-100 text-sky-700",
};

export default function SentryToolPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [active, setActive] = useState<string>("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState("");

  // LLM analysis state.
  const [linkInput, setLinkInput] = useState("");
  const [analyzing, setAnalyzing] = useState("");   // issue id/url currently analyzing
  const [result, setResult] = useState<Explanation | null>(null);
  const [analysisError, setAnalysisError] = useState("");

  useEffect(() => {
    api<Project[]>("/api/tools/sentry/projects").then(setProjects).catch((e) => setError(e.message));
  }, []);

  async function openProject(slug: string) {
    setActive(slug); setError("");
    try { setIssues(await api<Issue[]>(`/api/tools/sentry/issues?project=${slug}`)); }
    catch (e: any) { setError(e.message); setIssues([]); }
  }

  async function explain(issue: string) {
    if (!issue.trim()) return;
    setAnalyzing(issue);
    setAnalysisError("");
    setResult(null);
    try {
      setResult(await api<Explanation>("/api/tools/sentry/explain", {
        method: "POST",
        body: JSON.stringify({ issue }),
      }));
    } catch (e: any) {
      setAnalysisError(e.message ?? "Analiz başarısız");
    } finally {
      setAnalyzing("");
    }
  }

  return (
    <div className="flex h-screen">
      <div className="flex w-64 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <Link href="/marketplace" className="text-xs text-slate-400">← Marketplace</Link>
          <h2 className="mt-1 font-semibold">🛡️ Sentry</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {projects.map((p) => (
            <button key={p.slug} onClick={() => openProject(p.slug)}
              className={`block w-full truncate border-b border-slate-100 px-4 py-3 text-left text-sm ${active === p.slug ? "bg-slate-100 font-medium" : "hover:bg-slate-50"}`}>
              {p.name}
            </button>
          ))}
          {projects.length === 0 && <p className="p-4 text-sm text-slate-400">Proje yok / token geçersiz.</p>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {/* Paste a Sentry issue link → LLM explains + proposes a fix */}
        <div className="card mb-5 p-4">
          <p className="mb-2 text-sm font-medium text-slate-700">🔍 Hata linkini yapıştır → analiz et</p>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="https://<org>.sentry.io/issues/12345/ veya issue id"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") explain(linkInput); }}
            />
            <button className="btn" onClick={() => explain(linkInput)} disabled={!linkInput.trim() || analyzing === linkInput}>
              {analyzing === linkInput ? "Analiz ediliyor…" : "Analiz et"}
            </button>
          </div>
        </div>

        {analysisError && <p className="mb-4 text-sm text-red-600">⚠️ {analysisError}</p>}

        {/* Analysis result */}
        {result && (
          <div className="card mb-5 border-brand/30 p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="font-medium text-slate-800">{result.title || `Issue ${result.issue_id}`}</span>
              {result.permalink && (
                <a href={result.permalink} target="_blank" rel="noreferrer" className="text-xs text-brand">Sentry'de aç ↗</a>
              )}
              <button className="ml-auto text-xs text-slate-400 hover:text-slate-600" onClick={() => setResult(null)}>kapat ×</button>
            </div>
            <div className="whitespace-pre-wrap text-sm text-slate-700">{result.answer}</div>
          </div>
        )}

        {!active && !result && <p className="text-sm text-slate-400">Bir proje seçin ya da yukarıya bir hata linki yapıştırın.</p>}
        <div className="space-y-2">
          {issues.map((i) => (
            <div key={i.id} className="card p-4">
              <div className="flex items-center gap-2">
                <span className={`badge ${LEVEL[i.level] || "bg-slate-100 text-slate-600"}`}>{i.level || "?"}</span>
                <a href={i.permalink} target="_blank" rel="noreferrer" className="font-medium text-slate-800 hover:underline">{i.title}</a>
                <span className="ml-auto text-xs text-slate-400">{i.count}×</span>
                <button
                  className="btn-ghost text-xs"
                  onClick={() => { setLinkInput(i.permalink || i.id); explain(i.permalink || i.id); }}
                  disabled={analyzing === (i.permalink || i.id)}
                >
                  {analyzing === (i.permalink || i.id) ? "…" : "🔍 Analiz et"}
                </button>
              </div>
              {i.culprit && <p className="mt-1 text-xs text-slate-500">{i.culprit}</p>}
            </div>
          ))}
          {active && issues.length === 0 && <p className="text-sm text-slate-400">Açık issue yok. 🎉</p>}
        </div>
      </div>
    </div>
  );
}
