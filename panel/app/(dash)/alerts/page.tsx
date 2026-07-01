"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Alert } from "@/lib/types";

function SnippetText({ text }: { text: string }) {
  const parts = text.split("[MASKED]");
  return (
    <span>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 && (
            <span className="mx-0.5 inline-flex items-center rounded bg-red-100 dark:bg-red-900/40 px-1.5 py-0.5 font-semibold text-red-700 dark:text-red-300 text-xs ring-1 ring-red-300 dark:ring-red-700">
              ✂ MASKED
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

const SEV: Record<string, string> = {
  high:   "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  low:    "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};
const ACTION_TR: Record<string, string> = {
  mask:  "Maskelendi",
  block: "Bloklandı",
  flag:  "İşaretlendi",
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  async function refresh() {
    const q = onlyOpen ? "?resolved=false&limit=200" : "?limit=200";
    setAlerts(await api<Alert[]>(`/api/alerts${q}`));
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyOpen]);

  async function resolve(a: Alert) {
    await api(`/api/alerts/${a.id}/resolve`, { method: "POST" });
    refresh();
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // How many chars to show collapsed
  const COLLAPSE_AT = 300;

  return (
    <div className="h-screen overflow-y-auto p-8 dark:bg-slate-950">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="page-title">Alerts</h1>
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          Yalnızca açık uyarılar
        </label>
      </div>
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
        Politika tetiklenmeleri. Metinler maskelenmiş hâliyle saklanır — orijinal hassas veri görünmez.
      </p>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="space-y-3">
        {alerts.map((a) => {
          const isLong = a.snippet.length > COLLAPSE_AT;
          const isExpanded = expanded.has(a.id);
          const displaySnippet = isLong && !isExpanded
            ? a.snippet.slice(0, COLLAPSE_AT) + "…"
            : a.snippet;

          return (
            <div key={a.id} className="card dark:border-slate-700 dark:bg-slate-800 p-4 space-y-2">
              {/* Header row */}
              <div className="flex flex-wrap items-center gap-2">
                <span className={`badge ${SEV[a.severity]}`}>{a.severity}</span>
                <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                  {a.category}
                </span>
                <span className="font-medium text-slate-800 dark:text-slate-200">{a.rule_name}</span>
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  · {ACTION_TR[a.action] ?? a.action}
                </span>
                {a.resolved && (
                  <span className="badge bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
                    çözüldü
                  </span>
                )}
              </div>

              {/* Snippet */}
              <div className="rounded-lg bg-slate-50 dark:bg-slate-900 px-3 py-2.5 font-mono text-sm text-slate-700 dark:text-slate-300 break-words whitespace-pre-wrap">
                <SnippetText text={displaySnippet} />
                {isLong && (
                  <button
                    onClick={() => toggleExpand(a.id)}
                    className="mt-1 block text-xs text-brand hover:underline"
                  >
                    {isExpanded ? "Daha az göster ▲" : `Tamamını göster (${a.snippet.length} karakter) ▼`}
                  </button>
                )}
              </div>

              {/* Footer row */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {new Date(a.created_at).toLocaleString()}
                  {a.user_id && ` · kullanıcı ${a.user_id.slice(0, 8)}`}
                </p>

                <div className="flex items-center gap-2">
                  {a.conversation_id && (
                    <Link
                      href={`/conversations?convId=${a.conversation_id}`}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600 transition"
                    >
                      💬 Konuşmaya git
                    </Link>
                  )}
                  {!a.resolved && (
                    <button
                      className="btn-ghost text-xs px-2.5 py-1"
                      onClick={() => resolve(a)}
                    >
                      ✓ Çözüldü
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {alerts.length === 0 && !error && (
          <div className="card dark:border-slate-700 dark:bg-slate-800 p-10 text-center text-slate-400">
            <div className="mb-2 text-3xl">✅</div>
            Açık uyarı yok.
          </div>
        )}
      </div>
    </div>
  );
}
