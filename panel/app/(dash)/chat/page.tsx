"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, streamChat } from "@/lib/api";
import type { Conversation, Message, Provider } from "@/lib/types";

export default function ChatPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<Provider[]>("/api/providers")
      .then((ps) => {
        setProviders(ps);
        const usable = ps.find(
          (p) =>
            p.own_key ||
            (p.is_active && (
              (p.auth_mode === "api_key" && p.has_api_key) ||
              (p.auth_mode === "oauth2" && p.connected)
            )),
        );
        if (usable) setSelectedProvider(usable.id);
      })
      .catch(() => {});
    refreshConversations();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function refreshConversations() {
    setConversations(await api<Conversation[]>("/api/conversations"));
  }

  async function openConversation(id: string) {
    setActiveId(id);
    setError("");
    setMessages(await api<Message[]>(`/api/conversations/${id}/messages`));
  }

  function newChat() {
    setActiveId(null);
    setMessages([]);
    setError("");
  }

  const usableProviders = providers.filter(
    (p) =>
      p.own_key ||  // user's own key activates any provider regardless of shared key
      (p.is_active && (
        (p.auth_mode === "api_key" && p.has_api_key) ||
        (p.auth_mode === "oauth2" && p.connected)
      )),
  );
  const activeConvo = conversations.find((c) => c.id === activeId) ?? null;

  async function send() {
    if (!input.trim() || sending) return;
    const content = input.trim();
    setInput("");
    setSending(true);
    setError("");

    let convId = activeId;
    try {
      // Start a new conversation with the selected model if needed.
      if (!convId) {
        if (!selectedProvider) {
          setError("Önce bir model seçin (veya yöneticinizden bir sağlayıcı isteyin).");
          setSending(false);
          return;
        }
        const convo = await api<Conversation>("/api/conversations", {
          method: "POST",
          body: JSON.stringify({
            provider_id: selectedProvider,
            title: content.slice(0, 40),
          }),
        });
        convId = convo.id;
        setActiveId(convId);
        await refreshConversations();
      }

      setMessages((m) => [
        ...m,
        { id: "tmp-u", role: "user", content, tokens: 0 },
        { id: "tmp-a", role: "assistant", content: "", tokens: 0 },
      ]);
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
      setMessages(await api<Message[]>(`/api/conversations/${convId}/messages`));
      refreshConversations();
    } catch (e: any) {
      setError(e.message ?? "Gönderilemedi");
    } finally {
      setSending(false);
    }
  }

  // Model shown in the header: existing conversation's model, or the selector for a new chat.
  const headerModel = activeConvo?.model;

  return (
    <div className="flex h-screen">
      {/* Conversation history */}
      <div className="flex w-72 flex-col border-r border-slate-200 bg-white">
        <div className="p-3">
          <button className="btn w-full" onClick={newChat}>+ Yeni sohbet</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <p className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Geçmiş
          </p>
          {conversations.length === 0 && (
            <p className="p-4 text-sm text-slate-400">Henüz sohbet yok.</p>
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
        {/* Header: ChatGPT-style model selector for new chats, model label otherwise */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          {activeId ? (
            <>
              <span className="truncate font-medium">{activeConvo?.title ?? "Sohbet"}</span>
              {headerModel && <span className="badge bg-slate-100 text-slate-600">{headerModel}</span>}
            </>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">Model:</span>
              {usableProviders.length > 0 ? (
                <select
                  className="input max-w-xs"
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value)}
                >
                  {usableProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {p.default_model}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-sm text-amber-600">
                  Kullanılabilir model yok.{" "}
                  <Link href="/connections" className="underline">Kendi hesabını bağla</Link>
                </span>
              )}
            </div>
          )}
        </div>

        {messages.length === 0 && !activeId ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center text-slate-400">
            <div className="mb-3 text-4xl">💬</div>
            <p className="font-medium text-slate-500">Yeni bir sohbet başlat</p>
            <p className="text-sm">Yukarıdan modeli seç, mesajını yaz.</p>
          </div>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {messages.map((m, i) => {
              const isLast = i === messages.length - 1;
              const streaming = sending && isLast && m.role === "assistant";
              return (
                <div key={m.id + i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-2xl whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                      m.role === "user" ? "bg-brand text-white" : "border border-slate-200 bg-white text-slate-800"
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
        )}

        {error && <p className="px-6 pb-2 text-sm text-red-600">{error}</p>}
        <div className="flex items-end gap-2 border-t border-slate-200 bg-white p-4">
          <textarea
            className="input max-h-40 resize-none"
            rows={1}
            placeholder="Mesajını yaz…  (Enter ile gönder, Shift+Enter ile yeni satır)"
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
            {sending ? "…" : "Gönder"}
          </button>
        </div>
      </div>
    </div>
  );
}
