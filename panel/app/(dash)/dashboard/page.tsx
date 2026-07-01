"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { BarChart, Donut, LineChart } from "@/components/charts";

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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-5">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-800">{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [ts, setTs] = useState<TsPoint[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [usersTop, setUsersTop] = useState<UserRow[]>([]);
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
  }, [days]);

  return (
    <div className="h-screen overflow-y-auto p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="page-title mb-1">Dashboard</h1>
          <p className="text-sm text-slate-500">Kullanım, maliyet ve performans metrikleri.</p>
        </div>
        <select className="input max-w-[160px]" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Son 7 gün</option>
          <option value={30}>Son 30 gün</option>
          <option value={90}>Son 90 gün</option>
        </select>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="İstek" value={(summary?.requests ?? 0).toLocaleString("tr-TR")} />
        <Stat label="Token" value={(summary?.tokens ?? 0).toLocaleString("tr-TR")} />
        <Stat label="Tahmini Maliyet" value={`$${(summary?.estimated_cost_usd ?? 0).toFixed(2)}`} sub="liste fiyatı tahmini" />
        <Stat label="Ort. Gecikme" value={`${summary?.avg_latency_ms ?? 0} ms`} />
        <Stat label="p95 Gecikme" value={`${summary?.p95_latency_ms ?? 0} ms`} />
        <Stat label="Hata Oranı" value={`${((summary?.error_rate ?? 0) * 100).toFixed(1)}%`} sub={`${summary?.errors ?? 0} hata`} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <LineChart label="Günlük istek" color="#4f46e5" data={ts.map((p) => ({ x: p.day, y: p.requests }))} />
        </div>
        <div className="card p-5">
          <LineChart label="Günlük token" color="#0ea5e9" data={ts.map((p) => ({ x: p.day, y: p.tokens }))} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <Donut label="Model dağılımı (istek)" data={models.map((m) => ({ name: m.model, value: m.requests }))} />
        </div>
        <div className="card p-5">
          <BarChart label="En çok kullanan kullanıcılar (token)" data={usersTop.map((u) => ({ name: u.email, value: u.tokens }))} />
        </div>
      </div>
    </div>
  );
}
