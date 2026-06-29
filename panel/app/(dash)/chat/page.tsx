"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
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
    if (!input.trim() || !activeId) return;
    const content = input.trim();
    setInput("");
    setSending(true);
    setError("");
    // Optimistic user bubble.
    setMessages((m) => [...m, { id: "tmp", role: "user", content, tokens: 0 }]);
    try {
      const reply = await api<{ message: Message }>(`/api/conversations/${activeId}/chat`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      // Reload to get canonical ids + assistant reply.
      const msgs = await api<Message[]>(`/api/conversations/${activeId}/messages`);
      setMessages(msgs);
      void reply;
    } catch (e: any) {
      setError(e.message ?? "Failed to send");
    } finally {
      setSending(false);
    }
  }

  const activeProviders = providers.filter((p) => p.is_active);

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
          <div className="flex flex-1 items-center justify-center text-slate-400">
            Select or start a conversation.
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto p-6">
              {messages.map((m, i) => (
                <div
                  key={m.id + i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-2xl whitespace-pre-wrap rounded-lg px-4 py-2 text-sm ${
                      m.role === "user"
                        ? "bg-brand text-white"
                        : "border border-slate-200 bg-white"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {sending && <p className="text-sm text-slate-400">Assistant is typing…</p>}
              <div ref={bottomRef} />
            </div>
            {error && <p className="px-6 pb-2 text-sm text-red-600">{error}</p>}
            <div className="flex gap-2 border-t border-slate-200 p-4">
              <input
                className="input"
                placeholder="Type a message…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !sending && send()}
              />
              <button className="btn" onClick={send} disabled={sending}>
                Send
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
