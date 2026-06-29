"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { OwnKey, Provider } from "@/lib/types";

const BYOK_TYPES = [
  { type: "gemini", name: "Google Gemini", icon: "🔵", placeholder: "AIzaSy..." },
  { type: "openai", name: "OpenAI", icon: "🟢", placeholder: "sk-..." },
  { type: "anthropic", name: "Anthropic (Claude)", icon: "🟣", placeholder: "sk-ant-..." },
] as const;

export default function ConnectionsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [ownKeys, setOwnKeys] = useState<OwnKey[]>([]);
  const [error, setError] = useState("");
  const [justConnected, setJustConnected] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  // BYOK form state
  const [editType, setEditType] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [saving, setSaving] = useState(false);

  async function refresh() {
    const [ps, ks] = await Promise.all([
      api<Provider[]>("/api/providers"),
      api<OwnKey[]>("/api/user/own-keys"),
    ]);
    setProviders(ps);
    setOwnKeys(ks);
  }

  useEffect(() => {
    if (typeof window !== "undefined") {
      setJustConnected(new URLSearchParams(window.location.search).get("connected") === "1");
    }
    refresh().catch((e) => setError(e.message));
  }, []);

  async function connect(p: Provider) {
    try {
      const { auth_url } = await api<{ auth_url: string }>(`/api/providers/${p.id}/oauth/start`);
      window.location.href = auth_url;
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveOwnKey() {
    if (!editType || !keyInput.trim()) return;
    setSaving(true);
    try {
      await api(`/api/user/own-keys/${editType}`, {
        method: "PUT",
        body: JSON.stringify({ api_key: keyInput.trim(), label: labelInput.trim() }),
      });
      setEditType(null);
      setKeyInput("");
      setLabelInput("");
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 12000);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteOwnKey(provType: string) {
    try {
      await api(`/api/user/own-keys/${provType}`, { method: "DELETE" });
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const ownKeyMap = Object.fromEntries(ownKeys.map((k) => [k.provider_type, k]));
  const oauthProviders = providers.filter((p) => p.auth_mode === "oauth2");
  const sharedProviders = providers.filter((p) => p.auth_mode === "api_key" && p.is_active);

  return (
    <div className="h-screen overflow-y-auto p-8">
      <h1 className="page-title mb-1">Bağlantılarım</h1>
      <p className="mb-6 text-sm text-slate-500">
        Kendi API anahtarınızı ekleyin veya yöneticinizin ayarladığı sağlayıcılara bağlanın.
      </p>

      {justConnected && (
        <div className="mb-4 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">
          ✅ Bağlantı başarıyla tamamlandı.
        </div>
      )}
      {savedNotice && (
        <div className="mb-4 rounded-lg border border-blue-300 bg-blue-50 p-3 text-sm text-blue-800">
          ✅ Anahtar kaydedildi. Gateway senkronizasyonu ~10 saniye içinde tamamlanacak — sonrasında Chat'ten kullanabilirsiniz.
        </div>
      )}
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {/* ── BYOK: user's own API keys ── */}
      <h2 className="mb-1 font-semibold">Kendi API Anahtarlarım</h2>
      <p className="mb-3 text-xs text-slate-500">
        Kendi Gemini, OpenAI veya Anthropic anahtarınızı ekleyin. Eklediğinizde
        ortak anahtar yerine sizinkini kullanır; admin kurulumu gerekmez.
      </p>
      <div className="mb-8 space-y-3">
        {BYOK_TYPES.map(({ type, name, icon, placeholder }) => {
          const existing = ownKeyMap[type];
          const isEditing = editType === type;
          return (
            <div key={type} className="card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{icon} {name}</p>
                  {existing ? (
                    <p className="text-xs text-green-600">
                      ✓ Anahtar ayarlı{existing.label ? ` — ${existing.label}` : ""}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-400">Henüz anahtar eklenmedi</p>
                  )}
                </div>
                <div className="flex gap-2">
                  {existing && !isEditing && (
                    <button
                      className="btn-ghost text-sm"
                      onClick={() => deleteOwnKey(type)}
                    >
                      Sil
                    </button>
                  )}
                  <button
                    className={isEditing ? "btn-ghost text-sm" : "btn text-sm"}
                    onClick={() => {
                      if (isEditing) {
                        setEditType(null);
                        setKeyInput("");
                        setLabelInput("");
                      } else {
                        setEditType(type);
                        setKeyInput("");
                        setLabelInput(existing?.label ?? "");
                      }
                    }}
                  >
                    {isEditing ? "İptal" : existing ? "Güncelle" : "Ekle"}
                  </button>
                </div>
              </div>

              {isEditing && (
                <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                  <input
                    type="password"
                    className="input"
                    placeholder={`API anahtarı (${placeholder})`}
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    autoFocus
                  />
                  <input
                    type="text"
                    className="input"
                    placeholder="İsteğe bağlı etiket (örn. kişisel hesap)"
                    value={labelInput}
                    onChange={(e) => setLabelInput(e.target.value)}
                  />
                  <button
                    className="btn"
                    onClick={saveOwnKey}
                    disabled={saving || !keyInput.trim()}
                  >
                    {saving ? "Kaydediliyor…" : "Kaydet"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── OAuth2 providers (admin-configured) ── */}
      <h2 className="mb-2 font-semibold">OAuth2 Sağlayıcılar</h2>
      <div className="mb-8 space-y-3">
        {oauthProviders.length === 0 && (
          <div className="card p-6 text-sm text-slate-400">
            Yöneticiniz henüz OAuth2 sağlayıcı tanımlamamış.
          </div>
        )}
        {oauthProviders.map((p) => (
          <div key={p.id} className="card flex items-center justify-between p-4">
            <div>
              <p className="font-medium">{p.name}</p>
              <p className="text-xs text-slate-500">
                {p.type} · {p.default_model} ·{" "}
                {p.connected ? (
                  <span className="text-green-600">bağlı</span>
                ) : (
                  <span className="text-slate-400">bağlı değil</span>
                )}
              </p>
            </div>
            {p.connected ? (
              <span className="badge bg-green-100 text-green-700">Bağlı</span>
            ) : (
              <button className="btn" onClick={() => connect(p)}>Bağlan</button>
            )}
          </div>
        ))}
      </div>

      {/* ── Shared key providers (admin key, always ready) ── */}
      <h2 className="mb-2 font-semibold">Hazır Sağlayıcılar</h2>
      <p className="mb-2 text-xs text-slate-500">
        Yönetici tarafından sağlanan ortak anahtarla çalışır; bağlanmaya gerek yoktur.
      </p>
      <div className="space-y-3">
        {sharedProviders.length === 0 && (
          <div className="card p-6 text-sm text-slate-400">Hazır sağlayıcı yok.</div>
        )}
        {sharedProviders.map((p) => (
          <div key={p.id} className="card flex items-center justify-between p-4">
            <div>
              <p className="font-medium">{p.name}</p>
              <p className="text-xs text-slate-500">{p.type} · {p.default_model}</p>
            </div>
            <div className="flex gap-2">
              {p.own_key && (
                <span className="badge bg-blue-100 text-blue-700">Kendi anahtarın</span>
              )}
              <span className="badge bg-slate-100 text-slate-600">Hazır</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
