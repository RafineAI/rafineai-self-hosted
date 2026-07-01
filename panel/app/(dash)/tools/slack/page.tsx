"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, getRole } from "@/lib/api";

interface Channel { id: string; name: string; followed?: boolean }
interface Msg { ts: string; user: string; text: string }

export default function SlackToolPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [followed, setFollowed] = useState<Channel[]>([]);
  const [active, setActive] = useState<Channel | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isAdmin = getRole() === "owner" || getRole() === "admin";

  async function refreshFollowed() {
    setFollowed(await api<Channel[]>("/api/tools/slack/followed"));
  }
  useEffect(() => { refreshFollowed().catch((e) => setError(e.message)); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView(); }, [msgs]);

  async function loadAll() {
    setShowAll(true);
    try { setChannels(await api<Channel[]>("/api/tools/slack/channels")); }
    catch (e: any) { setError(e.message); }
  }

  async function openChannel(c: Channel) {
    setActive(c); setError("");
    try { setMsgs(await api<Msg[]>(`/api/tools/slack/messages?channel=${c.id}`)); }
    catch (e: any) { setError(e.message); setMsgs([]); }
  }

  async function follow(c: Channel) {
    await api("/api/tools/slack/follow", { method: "POST", body: JSON.stringify({ id: c.id, name: c.name }) });
    await refreshFollowed();
    await loadAll();
  }
  async function unfollow(c: Channel) {
    await api(`/api/tools/slack/follow/${c.id}`, { method: "DELETE" });
    await refreshFollowed();
    if (showAll) await loadAll();
    if (active?.id === c.id) setActive(null);
  }

  async function send() {
    if (!active || !input.trim()) return;
    const text = input.trim();
    setInput("");
    try {
      await api("/api/tools/slack/send", { method: "POST", body: JSON.stringify({ channel: active.id, text }) });
      await openChannel(active);
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="flex h-screen">
      {/* Channels */}
      <div className="flex w-64 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <Link href="/marketplace" className="text-xs text-slate-400">← Marketplace</Link>
          <h2 className="mt-1 font-semibold">💬 Slack</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          <p className="px-4 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Takip edilen</p>
          {followed.map((c) => (
            <div key={c.id} className="group flex items-center border-b border-slate-100 px-3 py-2 hover:bg-slate-50">
              <button className={`flex-1 truncate text-left text-sm ${active?.id === c.id ? "font-medium" : ""}`} onClick={() => openChannel(c)}>
                # {c.name}
              </button>
              {isAdmin && <button className="text-xs text-red-500 opacity-0 group-hover:opacity-100" onClick={() => unfollow(c)}>×</button>}
            </div>
          ))}
          {followed.length === 0 && <p className="px-4 py-2 text-xs text-slate-400">Henüz kanal takip edilmiyor.</p>}

          {isAdmin && (
            <div className="p-3">
              {!showAll ? (
                <button className="btn-ghost w-full text-sm" onClick={loadAll}>+ Kanal ekle</button>
              ) : (
                <>
                  <p className="px-1 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Tüm kanallar</p>
                  {channels.filter((c) => !c.followed).map((c) => (
                    <button key={c.id} className="block w-full truncate px-1 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-50" onClick={() => follow(c)}>
                      + # {c.name}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex flex-1 flex-col">
        <div className="border-b border-slate-200 bg-white px-5 py-3 font-medium">
          {active ? `# ${active.name}` : "Bir kanal seçin"}
        </div>
        {error && <p className="px-5 py-2 text-sm text-red-600">{error}</p>}
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {msgs.map((m, i) => (
            <div key={m.ts + i} className="text-sm">
              <span className="font-medium text-slate-800">{m.user}</span>
              <span className="ml-2 whitespace-pre-wrap text-slate-600">{m.text}</span>
            </div>
          ))}
          {active && msgs.length === 0 && <p className="text-sm text-slate-400">Mesaj yok.</p>}
          <div ref={bottomRef} />
        </div>
        {active && (
          <div className="flex gap-2 border-t border-slate-200 bg-white p-4">
            <input
              className="input flex-1"
              placeholder={`# ${active.name} kanalına yaz…`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            />
            <button className="btn" onClick={send} disabled={!input.trim()}>Gönder</button>
          </div>
        )}
      </div>
    </div>
  );
}
