"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Alert } from "@/lib/types";

const SEV: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-slate-100 text-slate-600",
};
const ACTION_TR: Record<string, string> = { mask: "Maskelendi", block: "Bloklandı", flag: "İşaretlendi" };

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [onlyOpen, setOnlyOpen] = useState(true);
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

  return (
    <div className="h-screen overflow-y-auto p-8">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="page-title">Alerts</h1>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
          Yalnızca açık uyarılar
        </label>
      </div>
      <p className="mb-6 text-sm text-slate-500">
        Politika tetiklenmeleri. Snippet’ler zaten maskelidir — orijinal hassas veri
        burada görünmez.
      </p>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="space-y-3">
        {alerts.map((a) => (
          <div key={a.id} className="card flex items-start justify-between gap-4 p-4">
            <div className="min-w-0">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className={`badge ${SEV[a.severity]}`}>{a.severity}</span>
                <span className="badge bg-slate-100 text-slate-600">{a.category}</span>
                <span className="font-medium">{a.rule_name}</span>
                <span className="text-xs text-slate-400">· {ACTION_TR[a.action] ?? a.action}</span>
                {a.resolved && <span className="badge bg-green-100 text-green-700">çözüldü</span>}
              </div>
              <p className="truncate font-mono text-sm text-slate-600">{a.snippet}</p>
              <p className="mt-1 text-xs text-slate-400">
                {new Date(a.created_at).toLocaleString()}
                {a.user_id ? ` · kullanıcı ${a.user_id.slice(0, 8)}` : ""}
              </p>
            </div>
            {!a.resolved && (
              <button className="btn-ghost shrink-0" onClick={() => resolve(a)}>Çözüldü işaretle</button>
            )}
          </div>
        ))}
        {alerts.length === 0 && !error && (
          <div className="card p-10 text-center text-slate-400">
            <div className="mb-2 text-3xl">✅</div>
            Açık uyarı yok.
          </div>
        )}
      </div>
    </div>
  );
}
