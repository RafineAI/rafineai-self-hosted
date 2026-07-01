"use client";

import { useEffect, useRef, useState } from "react";
import { api, authedBlobUrl } from "@/lib/api";
import type { Document } from "@/lib/types";

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function iconFor(mime: string): string {
  if (mime.startsWith("image/")) return "🖼️";
  if (mime === "application/pdf") return "📄";
  if (mime.startsWith("text/") || mime.includes("json") || mime.includes("xml")) return "📝";
  if (mime.includes("zip") || mime.includes("tar")) return "🗜️";
  return "📎";
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{ doc: Document; url: string; text?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    setDocs(await api<Document[]>("/api/documents"));
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  async function onUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        await api("/api/documents", { method: "POST", body: fd });
      }
      await refresh();
      if (fileRef.current) fileRef.current.value = "";
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function openPreview(doc: Document) {
    setError("");
    try {
      const url = await authedBlobUrl(`/api/documents/${doc.id}/content`);
      let text: string | undefined;
      if (
        doc.mime_type.startsWith("text/") ||
        doc.mime_type.includes("json") ||
        doc.mime_type.includes("xml") ||
        doc.mime_type.includes("javascript")
      ) {
        text = await (await fetch(url)).text();
      }
      setPreview({ doc, url, text });
    } catch (e: any) {
      setError(e.message);
    }
  }

  function closePreview() {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  }

  async function del(doc: Document) {
    if (!confirm(`"${doc.filename}" silinsin mi?`)) return;
    try {
      await api(`/api/documents/${doc.id}`, { method: "DELETE" });
      if (preview?.doc.id === doc.id) closePreview();
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="flex h-screen">
      <div className="flex-1 overflow-y-auto p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="page-title mb-1">Belgelerim</h1>
            <p className="text-sm text-slate-500">
              Dosyalarınızı güvenle saklayın, önizleyin ve sohbetlerde kullanın.
            </p>
          </div>
          <div>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => onUpload(e.target.files)}
            />
            <button className="btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? "Yükleniyor…" : "+ Dosya Yükle"}
            </button>
          </div>
        </div>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        <div className="card divide-y divide-slate-100">
          {docs.length === 0 && (
            <p className="p-8 text-center text-sm text-slate-400">
              Henüz belge yok. Yukarıdan dosya yükleyin.
            </p>
          )}
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 p-4 hover:bg-slate-50">
              <span className="text-2xl">{iconFor(d.mime_type)}</span>
              <button className="flex-1 text-left" onClick={() => openPreview(d)}>
                <p className="font-medium text-slate-800">{d.filename}</p>
                <p className="text-xs text-slate-400">
                  {d.mime_type} · {humanSize(d.size_bytes)} · {d.created_at.slice(0, 16).replace("T", " ")}
                  {d.indexed && <span className="ml-2 text-green-600">· RAG indeksli</span>}
                </p>
              </button>
              <button className="btn-ghost text-sm" onClick={() => openPreview(d)}>Önizle</button>
              <button className="btn-ghost text-sm text-red-600" onClick={() => del(d)}>Sil</button>
            </div>
          ))}
        </div>
      </div>

      {/* Preview panel */}
      {preview && (
        <div className="flex w-[45%] flex-col border-l border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
            <span className="truncate font-medium">{preview.doc.filename}</span>
            <button className="btn-ghost text-sm" onClick={closePreview}>Kapat</button>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {preview.doc.mime_type.startsWith("image/") && (
              <img src={preview.url} alt={preview.doc.filename} className="max-w-full rounded-lg" />
            )}
            {preview.doc.mime_type === "application/pdf" && (
              <iframe src={preview.url} title={preview.doc.filename} className="h-full min-h-[70vh] w-full rounded-lg border" />
            )}
            {preview.text !== undefined && (
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-4 text-xs text-slate-800">
                {preview.text}
              </pre>
            )}
            {!preview.doc.mime_type.startsWith("image/") &&
              preview.doc.mime_type !== "application/pdf" &&
              preview.text === undefined && (
                <div className="text-center text-sm text-slate-400">
                  <p className="mb-3">Bu dosya türü önizlenemiyor.</p>
                  <a className="btn" href={preview.url} download={preview.doc.filename}>İndir</a>
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
