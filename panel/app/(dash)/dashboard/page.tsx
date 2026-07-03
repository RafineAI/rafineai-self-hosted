"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { BarChart, Donut, LineChart } from "@/components/charts";
import type { Alert } from "@/lib/types";

interface Summary {
  requests: number;
  tokens: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  errors: number;
  error_rate: number;
  estimated_cost_usd: number;
}
interface TsPoint { day: string; requests: number; tokens: number }
interface ModelRow { model: string; requests: number; tokens: number; estimated_cost_usd: number }
interface UserRow { email: string; requests: number; tokens: number }

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="kpi">
      <p className="text-[11px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${accent ? "text-brand" : "text-slate-800 dark:text-slate-100"}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

// action → [pill class, label] for the live policy feed.
const PILL: Record<string, [string, string]> = {
  block: ["pill-crit", "engel"],
  mask: ["pill-good", "maske"],
  flag: ["pill-warn", "flag"],
};

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "az önce";
  if (s < 3600) return `${Math.floor(s / 60)} dk önce`;
  if (s < 86400) return `${Math.floor(s / 3600)} sa önce`;
  return `${Math.floor(s / 86400)} gün önce`;
}

export default function DashboardPage() {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [ts, setTs] = useState<TsPoint[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [usersTop, setUsersTop] = useState<UserRow[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const q = `?days=${days}`;
    Promise.all([
      api<Summary>(`/api/metrics/summary${q}`),
      api<TsPoint[]>(`/api/metrics/timeseries${q}`),
      api<ModelRow[]>(`/api/metrics/by_model${q}`),
      api<UserRow[]>(`/api/metrics/by_user${q}`),
    ])
      .then(([s, t, m, u]) => {
        setSummary(s); setTs(t); setModels(m); setUsersTop(u);
      })
      .catch((e) => setError(e.message));
    // Live policy feed (best-effort — never blocks the dashboard).
    api<Alert[]>("/api/alerts")
      .then((a) => setAlerts(Array.isArray(a) ? a : []))
      .catch(() => {});
  }, [days]);

  return (
    <div className="h-screen overflow-y-auto p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="page-title mb-1">Kontrol Merkezi</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Canlı · kullanım, maliyet ve politika akışı.</p>
        </div>
        <select className="input max-w-[160px]" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Son 7 gün</option>
          <option value={30}>Son 30 gün</option>
          <option value={90}>Son 90 gün</option>
        </select>
      </div>

      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="İstek" value={(summary?.requests ?? 0).toLocaleString("tr-TR")} />
        <Stat label="Token" value={(summary?.tokens ?? 0).toLocaleString("tr-TR")} />
        <Stat label="Tahmini Maliyet" value={`$${(summary?.estimated_cost_usd ?? 0).toFixed(2)}`} sub="liste fiyatı tahmini" />
        <Stat label="Ort. Gecikme" value={`${summary?.avg_latency_ms ?? 0} ms`} />
        <Stat label="p95 Gecikme" value={`${summary?.p95_latency_ms ?? 0} ms`} />
        <Stat label="Hata Oranı" value={`${((summary?.error_rate ?? 0) * 100).toFixed(1)}%`} sub={`${summary?.errors ?? 0} hata`} accent />
      </div>

      {/* Request volume + live policy feed (the control-center hero row) */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <div className="glass p-5">
          <LineChart label="İstek hacmi" color="#7c5cfc" data={ts.map((p) => ({ x: p.day, y: p.requests }))} />
        </div>
        <div className="glass p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Canlı politika akışı</p>
            <span className="text-xs text-slate-400">otomatik</span>
          </div>
          <div className="space-y-2.5">
            {alerts.length === 0 && <p className="text-sm text-slate-400">Henüz politika uyarısı yok.</p>}
            {alerts.slice(0, 6).map((a) => {
              const [cls, label] = PILL[a.action] ?? ["pill-warn", a.action];
              return (
                <div key={a.id} className="flex items-center gap-2.5 text-sm">
                  <span className={`pill ${cls}`}>{label}</span>
                  <span className="flex-1 truncate text-slate-700 dark:text-slate-200" title={a.rule_name}>{a.rule_name}</span>
                  <span className="shrink-0 text-xs text-slate-400">{ago(a.created_at)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <div className="glass p-5">
          <LineChart label="Günlük token" color="#22d3d3" data={ts.map((p) => ({ x: p.day, y: p.tokens }))} />
        </div>
        <div className="glass p-5">
          <Donut label="Model dağılımı (istek)" data={models.map((m) => ({ name: m.model, value: m.requests }))} />
        </div>
      </div>

      <div className="glass p-5">
        <BarChart label="En çok kullanan kullanıcılar (token)" data={usersTop.map((u) => ({ name: u.email, value: u.tokens }))} />
      </div>
    </div>
  );
}
