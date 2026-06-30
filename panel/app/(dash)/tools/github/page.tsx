"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

interface Repo { full_name: string; private: boolean; default_branch: string; description: string }
interface Entry { name: string; path: string; type: string; size: number }
interface FileContent { path: string; size: number; content: string }

export default function GithubToolPage() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [file, setFile] = useState<FileContent | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<Repo[]>("/api/tools/github/repos").then(setRepos).catch((e) => setError(e.message));
  }, []);

  async function openRepo(r: Repo, p = "") {
    setRepo(r); setPath(p); setFile(null); setError(""); setLoading(true);
    try {
      const [owner, name] = r.full_name.split("/");
      setEntries(await api<Entry[]>(`/api/tools/github/repos/${owner}/${name}/tree?path=${encodeURIComponent(p)}`));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function openEntry(e: Entry) {
    if (!repo) return;
    const [owner, name] = repo.full_name.split("/");
    if (e.type === "dir") {
      openRepo(repo, e.path);
      return;
    }
    setError(""); setLoading(true);
    try {
      setFile(await api<FileContent>(`/api/tools/github/repos/${owner}/${name}/file?path=${encodeURIComponent(e.path)}`));
    } catch (er: any) {
      setError(er.message);
    } finally {
      setLoading(false);
    }
  }

  function parentPath() {
    if (!repo) return;
    const parts = path.split("/").filter(Boolean);
    parts.pop();
    openRepo(repo, parts.join("/"));
  }

  return (
    <div className="flex h-screen">
      {/* Repo list */}
      <div className="flex w-72 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <Link href="/marketplace" className="text-xs text-slate-400">← Marketplace</Link>
          <h2 className="mt-1 font-semibold">🐙 GitHub</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {repos.map((r) => (
            <button
              key={r.full_name}
              onClick={() => openRepo(r)}
              className={`block w-full truncate border-b border-slate-100 px-4 py-3 text-left text-sm ${repo?.full_name === r.full_name ? "bg-slate-100 font-medium" : "hover:bg-slate-50"}`}
            >
              {r.full_name}
              {r.private && <span className="ml-1 text-xs text-slate-400">🔒</span>}
            </button>
          ))}
          {repos.length === 0 && <p className="p-4 text-sm text-slate-400">Repo yok ya da token geçersiz.</p>}
        </div>
      </div>

      {/* Browser + file */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-5 py-3 text-sm">
          <span className="font-medium">{repo?.full_name ?? "Repo seçin"}</span>
          {repo && <span className="text-slate-400">/ {path || "(kök)"}</span>}
        </div>
        {error && <p className="px-5 py-2 text-sm text-red-600">{error}</p>}
        {loading && <p className="px-5 py-2 text-sm text-slate-400">Yükleniyor…</p>}

        {file ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-2">
              <span className="text-sm font-medium">{file.path}</span>
              <div className="flex gap-2">
                <button className="btn-ghost text-sm" onClick={() => navigator.clipboard.writeText(file.content)}>Kopyala</button>
                <button className="btn-ghost text-sm" onClick={() => setFile(null)}>Geri</button>
              </div>
            </div>
            <pre className="flex-1 overflow-auto bg-slate-50 p-4 text-xs text-slate-800">{file.content}</pre>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-2">
            {repo && path && (
              <button className="block w-full px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-50" onClick={parentPath}>
                📁 ..
              </button>
            )}
            {entries.map((e) => (
              <button
                key={e.path}
                onClick={() => openEntry(e)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                {e.type === "dir" ? "📁" : "📄"} {e.name}
                {e.type === "file" && <span className="ml-2 text-xs text-slate-400">{(e.size / 1024).toFixed(1)} KB</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
