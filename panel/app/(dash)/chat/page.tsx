"use client";

import { useEffect, useRef, useState } from "react";
import { api, streamChat } from "@/lib/api";
import type { Conversation, Message, Provider } from "@/lib/types";

export default function ChatPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<Provider[]>("/api/providers").then(setProviders).catch(() => {});
    refreshConversations();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function refreshConversations() {
    const list = await api<Conversation[]>("/api/conversations");
    setConversations(list);
  }

  async function openConversation(id: string) {
    setActiveId(id);
    setError("");
    const msgs = await api<Message[]>(`/api/conversations/${id}/messages`);
    setMessages(msgs);
  }

  async function newConversation(providerId: string) {
    const convo = await api<Conversation>("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ provider_id: providerId, title: "New conversation" }),
    });
    await refreshConversations();
    setActiveId(convo.id);
    setMessages([]);
  }

  async function send() {
    if (!input.trim() || !activeId || sending) return;
    const content = input.trim();
    const convId = activeId;
    setInput("");
    setSending(true);
    setError("");
    // Optimistic user bubble + an empty assistant bubble we stream into.
    setMessages((m) => [
      ...m,
      { id: "tmp-u", role: "user", content, tokens: 0 },
      { id: "tmp-a", role: "assistant", content: "", tokens: 0 },
    ]);
    try {
      await streamChat(convId, content, (delta) => {
        setMessages((m) => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last && last.role === "assistant") {
            copy[copy.length - 1] = { ...last, content: last.content + delta };
          }
          return copy;
        });
      });
      // Reconcile with canonical persisted messages (ids, tokens).
      const msgs = await api<Message[]>(`/api/conversations/${convId}/messages`);
      setMessages(msgs);
      refreshConversations();
    } catch (e: any) {
      setError(e.message ?? "Failed to send");
    } finally {
      setSending(false);
    }
  }

  const activeProviders = providers.filter((p) => p.is_active);
  const activeConvo = conversations.find((c) => c.id === activeId) ?? null;

  return (
    <div className="flex h-screen">
      {/* Conversation list */}
      <div className="flex w-72 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-3">
          <ProviderPicker providers={activeProviders} onPick={newConversation} />
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && (
            <p className="p-4 text-sm text-slate-400">No conversations yet.</p>
          )}
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => openConversation(c.id)}
              className={`block w-full truncate border-b border-slate-100 px-4 py-3 text-left text-sm ${
                activeId === c.id ? "bg-slate-100 font-medium" : "hover:bg-slate-50"
              }`}
            >
              {c.title}
              <span className="block text-xs text-slate-400">{c.model}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Thread */}
      <div className="flex flex-1 flex-col">
        {!activeId ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center text-slate-400">
            <div className="mb-3 text-4xl">💬</div>
            <p className="font-medium text-slate-500">Select or start a conversation</p>
            <p className="text-sm">Pick a provider above to begin chatting.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
              <span className="truncate font-medium">{activeConvo?.title ?? "Conversation"}</span>
              {activeConvo?.model && (
                <span className="badge bg-slate-100 text-slate-600">{activeConvo.model}</span>
              )}
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-6">
              {messages.map((m, i) => {
                const isLast = i === messages.length - 1;
                const streaming = sending && isLast && m.role === "assistant";
                return (
                  <div
                    key={m.id + i}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-2xl whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                        m.role === "user"
                          ? "bg-brand text-white"
                          : "border border-slate-200 bg-white text-slate-800"
                      } ${streaming && !m.content ? "caret" : ""}`}
                    >
                      {m.content}
                      {streaming && m.content && <span className="caret" />}
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
            {error && <p className="px-6 pb-2 text-sm text-red-600">{error}</p>}
            <div className="flex items-end gap-2 border-t border-slate-200 bg-white p-4">
              <textarea
                className="input max-h-40 resize-none"
                rows={1}
                placeholder="Type a message…  (Enter to send, Shift+Enter for newline)"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!sending) send();
                  }
                }}
              />
              <button className="btn" onClick={send} disabled={sending || !input.trim()}>
                {sending ? "…" : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ProviderPicker({
  providers,
  onPick,
}: {
  providers: Provider[];
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (providers.length === 0) {
    return <p className="text-xs text-slate-400">No active providers. Ask an admin.</p>;
  }
  return (
    <div className="relative">
      <button className="btn w-full" onClick={() => setOpen((o) => !o)}>
        + New conversation
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg">
          {providers.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                onPick(p.id);
                setOpen(false);
              }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
              disabled={p.auth_mode === "oauth2" && !p.connected}
              title={
                p.auth_mode === "oauth2" && !p.connected
                  ? "Connect this provider first (Providers page)"
                  : ""
              }
            >
              {p.name}
              <span className="block text-xs text-slate-400">
                {p.type} · {p.default_model}
                {p.auth_mode === "oauth2" && !p.connected ? " · not connected" : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
