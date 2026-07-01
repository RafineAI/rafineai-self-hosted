"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

interface Project { slug: string; name: string }
interface Issue { id: string; title: string; culprit: string; level: string; count: string; last_seen: string; permalink: string }

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

  useEffect(() => {
    api<Project[]>("/api/tools/sentry/projects").then(setProjects).catch((e) => setError(e.message));
  }, []);

  async function openProject(slug: string) {
    setActive(slug); setError("");
    try { setIssues(await api<Issue[]>(`/api/tools/sentry/issues?project=${slug}`)); }
    catch (e: any) { setError(e.message); setIssues([]); }
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
        {!active && <p className="text-sm text-slate-400">Bir proje seçin.</p>}
        <div className="space-y-2">
          {issues.map((i) => (
            <a key={i.id} href={i.permalink} target="_blank" rel="noreferrer" className="card block p-4 hover:bg-slate-50">
              <div className="flex items-center gap-2">
                <span className={`badge ${LEVEL[i.level] || "bg-slate-100 text-slate-600"}`}>{i.level || "?"}</span>
                <span className="font-medium text-slate-800">{i.title}</span>
                <span className="ml-auto text-xs text-slate-400">{i.count}×</span>
              </div>
              {i.culprit && <p className="mt-1 text-xs text-slate-500">{i.culprit}</p>}
            </a>
          ))}
          {active && issues.length === 0 && <p className="text-sm text-slate-400">Açık issue yok. 🎉</p>}
        </div>
      </div>
    </div>
  );
}
