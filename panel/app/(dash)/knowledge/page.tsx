"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Document } from "@/lib/types";

export default function KnowledgePage() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [indexing, setIndexing] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  async function refresh() {
    setDocs(await api<Document[]>("/api/documents"));
  }
  useEffect(() => { refresh().catch((e) => setError(e.message)); }, []);

  async function indexDoc(d: Document) {
    setIndexing(d.id); setError("");
    try {
      await api(`/api/rag/index/${d.id}`, { method: "POST" });
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIndexing(null);
    }
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function ask() {
    if (!question.trim()) return;
    setAsking(true); setError(""); setAnswer(""); setSources([]);
    try {
      const r = await api<{ answer: string; sources: string[] }>("/api/rag/ask", {
        method: "POST",
        body: JSON.stringify({
          question: question.trim(),
          document_ids: selected.size ? Array.from(selected) : undefined,
        }),
      });
      setAnswer(r.answer);
      setSources(r.sources);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAsking(false);
    }
  }

  const indexed = docs.filter((d) => d.indexed);

  return (
    <div className="flex h-screen">
      {/* Document index list */}
      <div className="flex w-80 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <h2 className="font-semibold">📚 Bilgi Tabanı</h2>
          <p className="text-xs text-slate-500">Belgeleri indeksleyin, sonra soru sorun.</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {docs.length === 0 && (
            <p className="p-4 text-sm text-slate-400">
              Belge yok. <Link href="/documents" className="underline">Belgelerim</Link>'den yükleyin.
            </p>
          )}
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-slate-50">
              <input
                type="checkbox"
                disabled={!d.indexed}
                checked={selected.has(d.id)}
                onChange={() => toggle(d.id)}
                title={d.indexed ? "Soruya dahil et" : "Önce indeksleyin"}
              />
              <span className="flex-1 truncate text-sm" title={d.filename}>{d.filename}</span>
              {d.indexed ? (
                <span className="badge bg-green-100 text-green-700">indeksli</span>
              ) : (
                <button className="btn-ghost text-xs" disabled={indexing === d.id} onClick={() => indexDoc(d)}>
                  {indexing === d.id ? "…" : "İndeksle"}
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="border-t border-slate-200 p-3 text-xs text-slate-400">
          {selected.size > 0 ? `${selected.size} belge seçili` : `Tümü (${indexed.length} indeksli)`}
        </div>
      </div>

      {/* Q&A */}
      <div className="flex flex-1 flex-col">
        <div className="flex-1 overflow-y-auto p-8">
          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
          {!answer && !asking && (
            <div className="flex h-full flex-col items-center justify-center text-center text-slate-400">
              <div className="mb-3 text-4xl">📚</div>
              <p className="font-medium text-slate-500">Belgelerinize soru sorun</p>
              <p className="text-sm">Soldan belge seçin (boş bırakırsanız tümü kullanılır).</p>
            </div>
          )}
          {asking && <p className="text-slate-400">Yanıt hazırlanıyor…</p>}
          {answer && (
            <div className="mx-auto max-w-3xl">
              <div className="card whitespace-pre-wrap p-6 text-sm leading-relaxed text-slate-800">{answer}</div>
              {sources.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="text-xs text-slate-400">Kaynaklar:</span>
                  {sources.map((s) => <span key={s} className="badge bg-slate-100 text-slate-600">{s}</span>)}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex items-end gap-2 border-t border-slate-200 bg-white p-4">
          <textarea
            className="input max-h-32 resize-none"
            rows={1}
            placeholder="Belgelerinize bir soru sorun…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!asking) ask(); } }}
          />
          <button className="btn" onClick={ask} disabled={asking || !question.trim()}>Sor</button>
        </div>
      </div>
    </div>
  );
}
