"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";

interface ConvoRow {
  id: string;
  user_id: string;
  user_email: string;
  model: string;
  title: string;
  updated_at: string;
}

interface MsgRow {
  id: string;
  role: string;
  content: string;
  tokens: number;
  created_at: string;
}

export default function ConversationsPage() {
  return (
    <Suspense>
      <ConversationsInner />
    </Suspense>
  );
}

function ConversationsInner() {
  const searchParams = useSearchParams();
  const [convos, setConvos] = useState<ConvoRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MsgRow[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  async function open(id: string) {
    setActiveId(id);
    setError("");
    try {
      setMessages(await api<MsgRow[]>(`/api/admin/conversations/${id}/messages`));
    } catch (e: any) {
      setError(e.message);
    }
  }

  useEffect(() => {
    api<ConvoRow[]>("/api/admin/conversations")
      .then((rows) => {
        setConvos(rows);
        const convId = searchParams.get("convId");
        if (convId && rows.find((r) => r.id === convId)) {
          open(convId);
        }
      })
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const filtered = convos.filter(
    (c) =>
      !search ||
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      c.user_email.toLowerCase().includes(search.toLowerCase()),
  );

  const active = convos.find((c) => c.id === activeId) ?? null;

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-3">
          <h2 className="mb-2 font-semibold text-slate-700">Chat Geçmişi</h2>
          <input
            className="input w-full"
            placeholder="Başlık veya kullanıcı ara…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="p-4 text-sm text-slate-400">Konuşma bulunamadı.</p>
          )}
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => open(c.id)}
              className={`block w-full border-b border-slate-100 px-4 py-3 text-left text-sm transition ${
                activeId === c.id ? "bg-slate-100 font-medium" : "hover:bg-slate-50"
              }`}
            >
              <p className="truncate font-medium text-slate-800">{c.title || "—"}</p>
              <p className="truncate text-xs text-slate-500">{c.user_email}</p>
              <p className="text-xs text-slate-400">
                {c.model} · {new Date(c.updated_at).toLocaleString()}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Thread */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {active ? (
          <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-3">
            <div>
              <p className="font-medium">{active.title || "—"}</p>
              <p className="text-xs text-slate-500">
                {active.user_email} · {active.model}
              </p>
            </div>
          </div>
        ) : (
          <div className="border-b border-slate-200 bg-white px-6 py-3">
            <p className="text-sm text-slate-400">Bir konuşma seçin</p>
          </div>
        )}

        {error && <p className="px-6 py-2 text-sm text-red-600">{error}</p>}

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {!active && !error && (
            <div className="flex h-full items-center justify-center text-slate-400">
              <p>Soldan bir konuşma seçin.</p>
            </div>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-2xl whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                  m.role === "user"
                    ? "bg-brand text-white"
                    : "border border-slate-200 bg-white text-slate-800"
                }`}
              >
                {m.content}
                {m.tokens > 0 && (
                  <span className="ml-2 text-xs opacity-50">{m.tokens} tok</span>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
