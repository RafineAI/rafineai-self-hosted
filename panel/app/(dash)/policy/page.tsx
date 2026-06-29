"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Builtin, PolicyRule } from "@/lib/types";

const SEV: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-slate-100 text-slate-600",
};
const ACT: Record<string, string> = {
  mask: "bg-indigo-100 text-indigo-700",
  block: "bg-red-100 text-red-700",
  flag: "bg-amber-100 text-amber-700",
};

const ACTION_TR: Record<string, string> = { mask: "Maskele", block: "Blokla", flag: "Uyar" };

export default function PolicyPage() {
  const [builtins, setBuiltins] = useState<Builtin[]>([]);
  const [rules, setRules] = useState<PolicyRule[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "", category: "custom", kind: "keyword", pattern: "",
    action: "mask", severity: "medium",
  });

  async function refresh() {
    setRules(await api<PolicyRule[]>("/api/policy/rules"));
  }
  useEffect(() => {
    api<Builtin[]>("/api/policy/builtins").then(setBuiltins).catch(() => {});
    refresh().catch((e) => setError(e.message));
  }, []);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/api/policy/rules", { method: "POST", body: JSON.stringify(form) });
      setForm({ ...form, name: "", pattern: "" });
      refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function toggle(r: PolicyRule) {
    await api(`/api/policy/rules/${r.id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !r.enabled }),
    });
    refresh();
  }

  async function remove(r: PolicyRule) {
    if (!confirm(`Delete rule "${r.name}"?`)) return;
    await api(`/api/policy/rules/${r.id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div className="h-screen overflow-y-auto p-8">
      <h1 className="page-title mb-1">Policy Rules</h1>
      <p className="mb-6 text-sm text-slate-500">
        Hassas içerik tespiti. Eşleşmeler kullanıcıya görünmeden maskelenir/bloklanır
        ve admin’e uyarı düşer. Türkçe finansal ve müşteri-verisi sözlükleri dahildir.
      </p>

      {/* Built-in detectors */}
      <div className="card mb-8 p-5">
        <h2 className="mb-3 font-semibold">Yerleşik detektörler <span className="text-xs font-normal text-slate-400">(her zaman aktif)</span></h2>
        <div className="flex flex-wrap gap-2">
          {builtins.map((b) => (
            <span key={b.name} className="badge bg-slate-100 text-slate-600">
              {b.name}
              <span className={`badge ml-1 ${ACT[b.action]}`}>{ACTION_TR[b.action]}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Add custom rule */}
      <form onSubmit={create} className="card mb-8 grid grid-cols-2 gap-4 p-5 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium">Kural adı</label>
          <input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} required />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Kategori</label>
          <input className="input" value={form.category} onChange={(e) => set("category", e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Tür</label>
          <select className="input" value={form.kind} onChange={(e) => set("kind", e.target.value)}>
            <option value="keyword">Anahtar kelime</option>
            <option value="regex">Regex</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-sm font-medium">Desen</label>
          <input className="input" placeholder={form.kind === "regex" ? "örn. \\bGIZLI-\\d+\\b" : "örn. ProjeAtlas"}
            value={form.pattern} onChange={(e) => set("pattern", e.target.value)} required />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Aksiyon</label>
          <select className="input" value={form.action} onChange={(e) => set("action", e.target.value)}>
            <option value="mask">Maskele</option>
            <option value="block">Blokla</option>
            <option value="flag">Uyar</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Önem</label>
          <select className="input" value={form.severity} onChange={(e) => set("severity", e.target.value)}>
            <option value="low">Düşük</option>
            <option value="medium">Orta</option>
            <option value="high">Yüksek</option>
          </select>
        </div>
        <div className="flex items-end">
          <button className="btn w-full" type="submit">Kural ekle</button>
        </div>
      </form>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {/* Custom rules */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3">Ad</th>
              <th className="px-4 py-3">Kategori</th>
              <th className="px-4 py-3">Tür / Desen</th>
              <th className="px-4 py-3">Aksiyon</th>
              <th className="px-4 py-3">Önem</th>
              <th className="px-4 py-3 text-right">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium">{r.name}</td>
                <td className="px-4 py-3">{r.category}</td>
                <td className="px-4 py-3 text-slate-500">
                  <span className="text-xs uppercase">{r.kind}</span> · <code>{r.pattern}</code>
                </td>
                <td className="px-4 py-3"><span className={`badge ${ACT[r.action]}`}>{ACTION_TR[r.action]}</span></td>
                <td className="px-4 py-3"><span className={`badge ${SEV[r.severity]}`}>{r.severity}</span></td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <button className="btn-ghost" onClick={() => toggle(r)}>
                      {r.enabled ? "Pasifleştir" : "Aktifleştir"}
                    </button>
                    <button className="btn-ghost" onClick={() => remove(r)}>Sil</button>
                  </div>
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Henüz özel kural yok.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
