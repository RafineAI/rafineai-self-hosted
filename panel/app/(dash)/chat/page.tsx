"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, uploadFile, streamChat, clearSession, getRole } from "@/lib/api";
import { toggleDark, getDark } from "@/lib/theme-bootstrap";
import { useSettings } from "@/lib/settings-context";
import type { Attachment, Conversation, Message, Provider } from "@/lib/types";
import { useRouter } from "next/navigation";

function parseMessageContent(content: string): { text: string; attachments: Attachment[] } {
  // Strip attachment metadata block
  const attMatch = content.match(/\n\n<!--rafine-attachments:(\[[\s\S]*?\])-->$/);
  let text = attMatch ? content.slice(0, attMatch.index) : content;
  let attachments: Attachment[] = [];
  if (attMatch) {
    try { attachments = JSON.parse(attMatch[1]); } catch {}
  }
  // Strip <document> blocks injected for LLM context — not shown in the bubble
  text = text.replace(/<document filename="[^"]*">[\s\S]*?<\/document>/g, "").trim();
  return { text, attachments };
}

export default function ChatPage() {
  const router = useRouter();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [dark, setDark] = useState(false);
  const [search, setSearch] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = getRole() === "owner" || getRole() === "admin";
  const s = useSettings();

  function loadProviders() {
    api<Provider[]>("/api/providers")
      .then((ps) => {
        setProviders(ps);
        setSelectedProvider((cur) => {
          // Keep current selection if still usable; else pick first usable.
          const usable = ps.filter(
            (p) => p.own_key || (p.is_active && ((p.auth_mode === "api_key" && p.has_api_key) || (p.auth_mode === "oauth2" && p.connected))),
          );
          if (cur && usable.some((p) => p.id === cur)) return cur;
          return usable[0]?.id ?? "";
        });
      })
      .catch(() => {});
  }

  useEffect(() => {
    setDark(getDark());
    loadProviders();
    refreshConversations();
  }, []);

  // Re-fetch providers when the tab regains focus (user may have added a BYOK
  // key on the Connections page and navigated back).
  useEffect(() => {
    function onFocus() { loadProviders(); }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Close model dropdown on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (modelRef.current && !modelRef.current.contains(e.target as Node)) {
        setModelOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  async function refreshConversations() {
    setConversations(await api<Conversation[]>("/api/conversations"));
  }

  async function openConversation(id: string) {
    setActiveId(id);
    setError("");
    const msgs = await api<Message[]>(`/api/conversations/${id}/messages`);
    setMessages(msgs);
    // Sync selected provider to this conversation's provider
    const convo = conversations.find((c) => c.id === id);
    if (convo?.provider_id) setSelectedProvider(convo.provider_id);
  }

  function newChat() {
    setActiveId(null);
    setMessages([]);
    setError("");
    setPendingAttachments([]);
  }

  async function attachFile(file: File) {
    if (!selectedProvider) {
      setError("Önce bir model seçin.");
      return;
    }
    setUploadingFile(true);
    try {
      let convId = activeId;
      if (!convId) {
        const convo = await api<Conversation>("/api/conversations", {
          method: "POST",
          body: JSON.stringify({ provider_id: selectedProvider, title: file.name.slice(0, 40) }),
        });
        convId = convo.id;
        setActiveId(convId);
        await refreshConversations();
      }
      const fd = new FormData();
      fd.append("file", file);
      const att = await uploadFile<Attachment>(`/api/conversations/${convId}/upload`, fd);
      setPendingAttachments((prev) => [...prev, att]);
    } catch (e: any) {
      setError(e.message ?? "Dosya yüklenemedi");
    } finally {
      setUploadingFile(false);
    }
  }

  async function switchProvider(providerId: string) {
    setModelOpen(false);
    setSelectedProvider(providerId);
    if (activeId) {
      try {
        await api(`/api/conversations/${activeId}`, {
          method: "PATCH",
          body: JSON.stringify({ provider_id: providerId }),
        });
        await refreshConversations();
        // Update local active convo
        const updatedConvos = await api<Conversation[]>("/api/conversations");
        setConversations(updatedConvos);
      } catch (e: any) {
        setError(e.message);
      }
    }
  }

  function logout() {
    clearSession();
    router.replace("/login");
  }

  const usableProviders = providers.filter(
    (p) => p.own_key || (p.is_active && ((p.auth_mode === "api_key" && p.has_api_key) || (p.auth_mode === "oauth2" && p.connected))),
  );

  const activeConvo = conversations.find((c) => c.id === activeId) ?? null;
  const currentProvider = providers.find((p) => p.id === selectedProvider);

  const filteredConvos = conversations.filter(
    (c) => !search || c.title.toLowerCase().includes(search.toLowerCase()),
  );

  async function send() {
    if ((!input.trim() && pendingAttachments.length === 0) || sending) return;
    const text = input.trim();
    const atts = [...pendingAttachments];
    // Inject <document> blocks for files with extracted text (LLM reads these)
    const docBlocks = atts
      .filter((a) => a.text_content)
      .map((a) => `\n\n<document filename="${a.filename}">\n${a.text_content}\n</document>`)
      .join("");
    const attMeta = atts.length > 0 ? `\n\n<!--rafine-attachments:${JSON.stringify(atts)}-->` : "";
    const content = text + docBlocks + attMeta;
    setInput("");
    setPendingAttachments([]);
    setSending(true);
    setError("");

    let convId = activeId;
    try {
      if (!convId) {
        if (!selectedProvider) {
          setError("Önce bir model seçin.");
          setSending(false);
          return;
        }
        const convo = await api<Conversation>("/api/conversations", {
          method: "POST",
          body: JSON.stringify({ provider_id: selectedProvider, title: (text || atts[0]?.filename || "Yeni sohbet").slice(0, 40) }),
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
      let hadStreamError = false;
      await streamChat(
        convId,
        content,
        (delta) => {
          setMessages((m) => {
            const copy = [...m];
            const last = copy[copy.length - 1];
            if (last?.role === "assistant") {
              copy[copy.length - 1] = { ...last, content: last.content + delta };
            }
            return copy;
          });
        },
        (errMsg) => {
          // Error chunk from backend — show as toast, remove the empty assistant bubble
          hadStreamError = true;
          setToast(errMsg);
          setMessages((m) => m.filter((msg) => msg.id !== "tmp-a"));
          setTimeout(() => setToast(null), 6000);
        },
      );
      if (!hadStreamError) {
        setMessages(await api<Message[]>(`/api/conversations/${convId}/messages`));
      }
      refreshConversations();
    } catch (e: any) {
      setError(e.message ?? "Gönderilemedi");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-screen bg-white dark:bg-slate-900">
      {/* ── Left: conversation history ─────────────────────────────── */}
      <div className="flex w-72 shrink-0 flex-col border-r border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-4 py-3">
          <span className="font-semibold text-slate-800 dark:text-slate-100">Sohbetler</span>
          <button
            onClick={newChat}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-white text-lg font-bold hover:bg-brand-dark transition"
            title="Yeni sohbet"
          >
            +
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
          <input
            className="input text-xs py-1.5"
            placeholder="Sohbet ara…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {filteredConvos.length === 0 && (
            <p className="p-4 text-sm text-slate-400 dark:text-slate-500">
              {search ? "Bulunamadı." : "Henüz sohbet yok."}
            </p>
          )}
          {filteredConvos.map((c) => (
            <button
              key={c.id}
              onClick={() => openConversation(c.id)}
              className={`block w-full border-b border-slate-100 dark:border-slate-800 px-4 py-3 text-left text-sm transition ${
                activeId === c.id
                  ? "bg-brand/10 dark:bg-brand/20 font-medium"
                  : "hover:bg-slate-50 dark:hover:bg-slate-800"
              }`}
            >
              <p className="truncate text-slate-800 dark:text-slate-200">{c.title}</p>
              <p className="truncate text-xs text-slate-400 dark:text-slate-500">{c.model}</p>
            </button>
          ))}
        </div>

        {/* Footer: dark toggle + connections (non-admin) + logout */}
        <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 px-3 py-2 gap-1">
          {!isAdmin && (
            <Link
              href="/connections"
              className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition text-base"
              title="Bağlantılarım"
            >
              🔗
            </Link>
          )}
          <button
            onClick={() => setDark(toggleDark())}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition text-base"
            title={dark ? "Açık tema" : "Koyu tema"}
          >
            {dark ? "☀️" : "🌙"}
          </button>
          <div className="flex-1" />
          <button
            onClick={logout}
            className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
            title="Çıkış"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 015.25 2h5.5A2.25 2.25 0 0113 4.25v2a.75.75 0 01-1.5 0v-2a.75.75 0 00-.75-.75h-5.5a.75.75 0 00-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 00.75-.75v-2a.75.75 0 011.5 0v2A2.25 2.25 0 0110.75 18h-5.5A2.25 2.25 0 013 15.75V4.25z" clipRule="evenodd" />
              <path fillRule="evenodd" d="M19 10a.75.75 0 00-.75-.75H8.704l1.048-1.08a.75.75 0 10-1.004-1.118l-2.5 2.572a.75.75 0 000 1.052l2.5 2.572a.75.75 0 101.004-1.118L8.704 10.75H18.25A.75.75 0 0019 10z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Right: chat thread ─────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">

        {/* ── Model selector — top center ──────────────────────────── */}
        <div className="flex items-center justify-center border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-6 py-2">
          {usableProviders.length === 0 ? (
            <span className="text-sm text-amber-600 dark:text-amber-400">
              Kullanılabilir model yok.{" "}
              <Link href="/connections" className="underline">Kendi hesabını bağla</Link>
            </span>
          ) : (
            <div className="relative" ref={modelRef}>
              <button
                onClick={() => setModelOpen((v) => !v)}
                className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 shadow-sm hover:border-brand/60 hover:shadow-md transition"
              >
                <span className="text-base">🤖</span>
                <span>{currentProvider?.name ?? "Model seç"}</span>
                {currentProvider && (
                  <span className="text-xs text-slate-400 dark:text-slate-500">— {currentProvider.default_model}</span>
                )}
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className={`h-3.5 w-3.5 text-slate-400 transition-transform ${modelOpen ? "rotate-180" : ""}`}>
                  <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 011.06 0L8 8.94l2.72-2.72a.75.75 0 111.06 1.06l-3.25 3.25a.75.75 0 01-1.06 0L4.22 7.28a.75.75 0 010-1.06z" clipRule="evenodd" />
                </svg>
              </button>

              {modelOpen && (
                <div className="absolute left-1/2 top-full z-50 mt-1.5 w-72 -translate-x-1/2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 shadow-xl overflow-hidden">
                  {usableProviders.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => switchProvider(p.id)}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-slate-700 ${
                        selectedProvider === p.id ? "bg-brand/5 dark:bg-brand/10" : ""
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-800 dark:text-slate-200">{p.name}</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500">{p.default_model}</p>
                      </div>
                      {selectedProvider === p.id && (
                        <span className="text-brand text-base">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Messages */}
        {messages.length === 0 && !activeId ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center text-slate-400 dark:text-slate-500">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/10 dark:bg-brand/20 text-3xl">💬</div>
            <p className="font-medium text-slate-600 dark:text-slate-300">{s.chat_welcome_title}</p>
            <p className="mt-1 text-sm">{s.chat_welcome_subtitle}</p>
          </div>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {messages.map((m, i) => {
              const isLast = i === messages.length - 1;
              const streaming = sending && isLast && m.role === "assistant";
              const { text, attachments: atts } = parseMessageContent(m.content);
              return (
                <div key={m.id + i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-2xl rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                      m.role === "user"
                        ? "bg-brand text-white"
                        : "border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                    } ${streaming && !m.content ? "caret" : ""}`}
                  >
                    {text && <span className="whitespace-pre-wrap">{text}</span>}
                    {atts.length > 0 && (
                      <div className={`flex flex-wrap gap-2 ${text ? "mt-2 pt-2 border-t border-white/20" : ""}`}>
                        {atts.map((a, ai) =>
                          a.content_type.startsWith("image/") ? (
                            <img key={ai} src={a.url} alt={a.filename} className="max-h-48 max-w-xs rounded-lg object-contain" />
                          ) : (
                            <a
                              key={ai}
                              href={a.url}
                              download={a.filename}
                              target="_blank"
                              rel="noopener noreferrer"
                              className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ${
                                m.role === "user"
                                  ? "bg-white/20 text-white hover:bg-white/30"
                                  : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
                              }`}
                            >
                              📎 {a.filename}
                            </a>
                          )
                        )}
                      </div>
                    )}
                    {streaming && m.content && <span className="caret" />}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}

        {error && (
          <p className="px-6 pb-2 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {/* Stream error toast */}
        {toast && (
          <div className="mx-4 mb-3 flex items-start gap-3 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-300 shadow-md">
            <span className="mt-0.5 text-base shrink-0">⚠️</span>
            <span className="flex-1">{toast}</span>
            <button
              onClick={() => setToast(null)}
              className="shrink-0 text-amber-500 hover:text-amber-700 dark:hover:text-amber-200 text-lg leading-none"
            >
              ×
            </button>
          </div>
        )}

        {/* Input */}
        <div className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          {/* Pending attachment chips */}
          {pendingAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pt-3">
              {pendingAttachments.map((a, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded-lg bg-brand/10 dark:bg-brand/20 px-2.5 py-1 text-xs text-brand dark:text-brand">
                  {a.content_type.startsWith("image/") ? "🖼️" : a.content_type === "application/pdf" ? "📄" : "📎"}
                  <span className="max-w-[140px] truncate">{a.filename}</span>
                  {a.text_content && (
                    <span className="text-brand/60" title="İçerik çıkarıldı, LLM okuyabilir">✓</span>
                  )}
                  <button
                    type="button"
                    className="text-brand/60 hover:text-brand ml-0.5"
                    onClick={() => setPendingAttachments((p) => p.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 p-4">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) attachFile(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingFile || sending}
              title="Dosya ekle"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-600 dark:hover:text-slate-300 transition disabled:opacity-40"
            >
              {uploadingFile ? (
                <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M15.621 4.379a3 3 0 00-4.242 0l-7 7a1.5 1.5 0 002.122 2.121L14 6.121a.5.5 0 01.707.707l-3.5 3.5a2.5 2.5 0 01-3.536 0 2.5 2.5 0 010-3.536l7-7a4.5 4.5 0 016.364 6.364l-3.5 3.5a.75.75 0 01-1.06-1.06l3.5-3.5a3 3 0 000-4.243z" clipRule="evenodd" />
                  <path fillRule="evenodd" d="M9.166 16.874a3 3 0 004.243 0l7-7a.75.75 0 00-1.06-1.06l-7 7a1.5 1.5 0 01-2.122-2.122l3.5-3.5a.75.75 0 00-1.06-1.06l-3.5 3.5a3 3 0 000 4.242z" clipRule="evenodd" />
                </svg>
              )}
            </button>
            <textarea
              className="input max-h-40 resize-none dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100"
              rows={1}
              placeholder={s.chat_placeholder}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!sending) send();
                }
              }}
              onPaste={(e) => {
                const items = Array.from(e.clipboardData?.items ?? []);
                const imageItem = items.find((it) => it.kind === "file" && it.type.startsWith("image/"));
                if (!imageItem) return;
                const file = imageItem.getAsFile();
                if (!file) return;
                e.preventDefault();
                // Give it a timestamped name since clipboard items have no filename
                const ext = file.type.split("/")[1] ?? "png";
                const named = new File([file], `screenshot-${Date.now()}.${ext}`, { type: file.type });
                attachFile(named);
              }}
            />
            <button
              className="btn shrink-0"
              onClick={send}
              disabled={sending || (!input.trim() && pendingAttachments.length === 0)}
            >
              {sending ? "…" : s.chat_send_label}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
