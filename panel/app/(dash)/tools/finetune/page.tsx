"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Document } from "@/lib/types";

interface Job {
  id: string; base_model: string; external_job_id: string;
  status: string; fine_tuned_model: string; error: string; created_at: string;
}

const STATUS: Record<string, string> = {
  succeeded: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-slate-100 text-slate-500",
  running: "bg-sky-100 text-sky-700",
  queued: "bg-amber-100 text-amber-700",
  pending: "bg-amber-100 text-amber-700",
};

export default function FinetuneToolPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [docs, setDocs] = useState<Document[]>([]);
  const [docId, setDocId] = useState("");
  const [baseModel, setBaseModel] = useState("gpt-4o-mini-2024-07-18");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  async function refresh() {
    const [j, d] = await Promise.all([
      api<Job[]>("/api/tools/finetune/jobs"),
      api<Document[]>("/api/documents"),
    ]);
    setJobs(j);
    setDocs(d.filter((x) => x.filename.endsWith(".jsonl") || x.mime_type.includes("json")));
  }
  useEffect(() => { refresh().catch((e) => setError(e.message)); }, []);

  async function create() {
    if (!docId) { setError("Eğitim belgesi seçin (.jsonl)."); return; }
    setCreating(true); setError("");
    try {
      await api("/api/tools/finetune/jobs", {
        method: "POST",
        body: JSON.stringify({ document_id: docId, base_model: baseModel }),
      });
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="h-screen overflow-y-auto p-8">
      <Link href="/marketplace" className="text-xs text-slate-400">← Marketplace</Link>
      <h1 className="page-title mb-1 mt-1">🎯 Fine-tuning</h1>
      <p className="mb-6 text-sm text-slate-500">
        Belgelerim'e yüklediğiniz JSONL eğitim dosyasıyla OpenAI üzerinde fine-tune işi başlatın.
        OpenAI anahtarınızı Bağlantılarım'dan eklemelisiniz.
      </p>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="card mb-8 space-y-3 p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">Eğitim belgesi (.jsonl)</label>
            <select className="input" value={docId} onChange={(e) => setDocId(e.target.value)}>
              <option value="">— seçin —</option>
              {docs.map((d) => <option key={d.id} value={d.id}>{d.filename}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Temel model</label>
            <input className="input" value={baseModel} onChange={(e) => setBaseModel(e.target.value)} />
          </div>
        </div>
        <button className="btn" onClick={create} disabled={creating || !docId}>
          {creating ? "Başlatılıyor…" : "Fine-tune başlat"}
        </button>
        {docs.length === 0 && (
          <p className="text-xs text-amber-600">
            JSONL belge bulunamadı. Önce <Link href="/documents" className="underline">Belgelerim</Link>'e bir .jsonl yükleyin.
          </p>
        )}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3">Temel model</th>
              <th className="px-4 py-3">Job ID</th>
              <th className="px-4 py-3">Durum</th>
              <th className="px-4 py-3">Sonuç modeli</th>
              <th className="px-4 py-3">Tarih</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="border-t border-slate-100">
                <td className="px-4 py-3">{j.base_model}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{j.external_job_id || "—"}</td>
                <td className="px-4 py-3"><span className={`badge ${STATUS[j.status] || "bg-slate-100 text-slate-600"}`}>{j.status}</span></td>
                <td className="px-4 py-3 font-mono text-xs">{j.fine_tuned_model || "—"}</td>
                <td className="px-4 py-3 text-slate-400">{j.created_at.slice(0, 16).replace("T", " ")}</td>
              </tr>
            ))}
            {jobs.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Henüz iş yok.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
