"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { OwnKey, Provider } from "@/lib/types";

interface ByokType {
  type: string;
  name: string;
  icon: string;
  placeholder: string;
  consoleUrl: string;
  consoleLabel: string;
  steps: string[];
}

const BYOK_TYPES: ByokType[] = [
  {
    type: "openai",
    name: "OpenAI",
    icon: "🟢",
    placeholder: "sk-proj-… veya sk-…",
    consoleUrl: "https://platform.openai.com/api-keys",
    consoleLabel: "OpenAI Platform → API Keys",
    steps: [
      "platform.openai.com adresine git ve giriş yap.",
      "Soldan API Keys'e tıkla.",
      "Create new secret key → anahtarı kopyala.",
      "Aşağıya yapıştır ve Bağla'ya bas.",
    ],
  },
  {
    type: "anthropic",
    name: "Anthropic (Claude)",
    icon: "🟣",
    placeholder: "sk-ant-api03-…",
    consoleUrl: "https://console.anthropic.com/settings/keys",
    consoleLabel: "Anthropic Console → API Keys",
    steps: [
      "console.anthropic.com adresine git ve giriş yap.",
      "Soldan API Keys'e tıkla.",
      "Create Key → anahtarı kopyala (yalnızca bir kez gösterilir).",
      "Aşağıya yapıştır ve Bağla'ya bas.",
    ],
  },
  {
    type: "gemini",
    name: "Google Gemini",
    icon: "🔵",
    placeholder: "AIzaSy…",
    consoleUrl: "https://aistudio.google.com/app/apikey",
    consoleLabel: "Google AI Studio → API Keys",
    steps: [
      "aistudio.google.com adresine git ve giriş yap.",
      "Get API key → Create API key seç.",
      "Anahtarı kopyala.",
      "Aşağıya yapıştır ve Bağla'ya bas.",
    ],
  },
];

export default function ConnectionsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [ownKeys, setOwnKeys] = useState<OwnKey[]>([]);
  const [error, setError] = useState("");
  const [justConnected, setJustConnected] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const [editType, setEditType] = useState<string | null>(null);
  const [step, setStep] = useState<"guide" | "key">("guide");
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

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

  function openConnect(type: string) {
    setEditType(type);
    setStep("guide");
    setKeyInput("");
    setSaveError("");
  }

  function closeConnect() {
    setEditType(null);
    setKeyInput("");
    setSaveError("");
  }

  async function saveKey() {
    if (!editType || !keyInput.trim()) return;
    setSaving(true);
    setSaveError("");
    try {
      await api(`/api/user/own-keys/${editType}`, {
        method: "PUT",
        body: JSON.stringify({ api_key: keyInput.trim(), label: "" }),
      });
      closeConnect();
      const byok = BYOK_TYPES.find((b) => b.type === editType);
      setSavedNotice(byok?.name ?? editType);
      setTimeout(() => setSavedNotice(null), 10000);
      await refresh();
    } catch (e: any) {
      setSaveError(e.message ?? "Kaydedilemedi");
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

  async function connectOAuth(p: Provider) {
    try {
      const { auth_url } = await api<{ auth_url: string }>(`/api/providers/${p.id}/oauth/start`);
      window.location.href = auth_url;
    } catch (e: any) {
      setError(e.message);
    }
  }

  const ownKeyMap = Object.fromEntries(ownKeys.map((k) => [k.provider_type, k]));
  const oauthProviders = providers.filter((p) => p.auth_mode === "oauth2");
  const sharedProviders = providers.filter((p) => p.auth_mode === "api_key" && p.is_active);
  const activeDef = BYOK_TYPES.find((b) => b.type === editType);

  return (
    <div className="h-screen overflow-y-auto p-8 dark:bg-slate-950">
      <h1 className="page-title mb-1 dark:text-slate-100">Bağlantılarım</h1>
      <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
        Kendi hesabınızı bağlayın veya yöneticinizin ayarladığı sağlayıcıları kullanın.
      </p>

      {justConnected && (
        <div className="mb-4 rounded-lg border border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-900/20 p-3 text-sm text-green-800 dark:text-green-300">
          ✅ Bağlantı başarıyla tamamlandı.
        </div>
      )}
      {savedNotice && (
        <div className="mb-4 rounded-lg border border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20 p-3 text-sm text-blue-800 dark:text-blue-300">
          ✅ <strong>{savedNotice}</strong> hesabınız bağlandı. Gateway senkronizasyonu ~30 saniye içinde
          tamamlanacak — sonrasında Chat ekranından kullanabilirsiniz.
        </div>
      )}
      {error && <p className="mb-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      {/* ── Connection modal / inline panel ── */}
      {editType && activeDef && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{activeDef.icon}</span>
                <div>
                  <p className="font-semibold text-slate-800 dark:text-slate-100">{activeDef.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Hesap bağlantısı</p>
                </div>
              </div>
              <button
                onClick={closeConnect}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="p-5">
              {step === "guide" ? (
                <>
                  {/* Step-by-step guide */}
                  <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
                    API anahtarı almak için şu adımları izle:
                  </p>
                  <ol className="mb-5 space-y-3">
                    {activeDef.steps.map((s, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/10 dark:bg-brand/20 text-xs font-bold text-brand">
                          {i + 1}
                        </span>
                        <span className="text-sm text-slate-700 dark:text-slate-300">{s}</span>
                      </li>
                    ))}
                  </ol>
                  <a
                    href={activeDef.consoleUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mb-4 flex items-center gap-2 rounded-xl border border-brand/30 dark:border-brand/40 bg-brand/5 dark:bg-brand/10 px-4 py-3 text-sm font-medium text-brand hover:bg-brand/10 dark:hover:bg-brand/20 transition"
                  >
                    <span className="text-base">🔗</span>
                    <span>{activeDef.consoleLabel}</span>
                    <span className="ml-auto text-brand/60 text-xs">↗</span>
                  </a>
                  <button
                    className="btn w-full"
                    onClick={() => setStep("key")}
                  >
                    Anahtarı aldım, devam et →
                  </button>
                </>
              ) : (
                <>
                  {/* Key entry */}
                  <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
                    {activeDef.consoleLabel} adresinden kopyaladığın API anahtarını gir:
                  </p>
                  <input
                    type="password"
                    className="input mb-2"
                    placeholder={activeDef.placeholder}
                    value={keyInput}
                    onChange={(e) => setKeyInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && saveKey()}
                    autoFocus
                  />
                  {saveError && (
                    <p className="mb-2 text-sm text-red-600 dark:text-red-400">⚠️ {saveError}</p>
                  )}
                  <div className="mt-3 flex gap-2">
                    <button
                      className="btn-ghost flex-1 text-sm"
                      onClick={() => setStep("guide")}
                    >
                      ← Geri
                    </button>
                    <button
                      className="btn flex-1"
                      onClick={saveKey}
                      disabled={saving || !keyInput.trim()}
                    >
                      {saving ? "Doğrulanıyor…" : "Bağla"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── BYOK cards ── */}
      <h2 className="mb-3 font-semibold text-slate-800 dark:text-slate-200">Kendi Hesabını Bağla</h2>
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        {BYOK_TYPES.map(({ type, name, icon }) => {
          const existing = ownKeyMap[type];
          return (
            <div
              key={type}
              className={`card dark:border-slate-700 dark:bg-slate-800 flex flex-col gap-3 p-5 ${
                existing ? "border-green-200 dark:border-green-700 bg-green-50/30 dark:bg-green-900/10" : ""
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-2xl">{icon}</span>
                  <div>
                    <p className="font-semibold text-slate-800 dark:text-slate-100">{name}</p>
                    {existing ? (
                      <p className="text-xs text-green-600 dark:text-green-400">✓ Bağlı</p>
                    ) : (
                      <p className="text-xs text-slate-400 dark:text-slate-500">Bağlı değil</p>
                    )}
                  </div>
                </div>
                {existing && (
                  <span className="rounded-full bg-green-100 dark:bg-green-800/40 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">
                    Aktif
                  </span>
                )}
              </div>

              <div className="flex gap-2 mt-auto">
                {existing ? (
                  <>
                    <button
                      className="btn flex-1 text-sm"
                      onClick={() => openConnect(type)}
                    >
                      Güncelle
                    </button>
                    <button
                      className="btn-ghost text-sm text-red-500 hover:text-red-700 dark:text-red-400 px-3"
                      onClick={() => deleteOwnKey(type)}
                      title="Bağlantıyı kaldır"
                    >
                      🗑
                    </button>
                  </>
                ) : (
                  <button
                    className="btn w-full text-sm"
                    onClick={() => openConnect(type)}
                  >
                    Hesabını Bağla
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── OAuth2 providers ── */}
      {oauthProviders.length > 0 && (
        <>
          <h2 className="mb-3 font-semibold text-slate-800 dark:text-slate-200">OAuth2 Sağlayıcılar</h2>
          <div className="mb-8 space-y-3">
            {oauthProviders.map((p) => (
              <div
                key={p.id}
                className="card dark:border-slate-700 dark:bg-slate-800 flex items-center justify-between p-4"
              >
                <div>
                  <p className="font-medium dark:text-slate-100">{p.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {p.type} · {p.default_model} ·{" "}
                    {p.connected ? (
                      <span className="text-green-600 dark:text-green-400">bağlı</span>
                    ) : (
                      <span className="text-slate-400">bağlı değil</span>
                    )}
                  </p>
                </div>
                {p.connected ? (
                  <span className="badge bg-green-100 dark:bg-green-800/40 text-green-700 dark:text-green-300">Bağlı</span>
                ) : (
                  <button className="btn" onClick={() => connectOAuth(p)}>Bağlan</button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── Shared/ready providers ── */}
      <h2 className="mb-2 font-semibold text-slate-800 dark:text-slate-200">Yönetici Sağlayıcılar</h2>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        Yöneticinin yapılandırdığı sağlayıcılar — ek bağlantı gerekmez.
      </p>
      <div className="space-y-3">
        {sharedProviders.length === 0 && (
          <div className="card dark:border-slate-700 dark:bg-slate-800 p-6 text-sm text-slate-400 dark:text-slate-500">
            Yönetici henüz hazır sağlayıcı tanımlamamış.
          </div>
        )}
        {sharedProviders.map((p) => (
          <div
            key={p.id}
            className="card dark:border-slate-700 dark:bg-slate-800 flex items-center justify-between p-4"
          >
            <div>
              <p className="font-medium dark:text-slate-100">{p.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {p.type} · {p.default_model}
              </p>
            </div>
            <div className="flex gap-2">
              {p.own_key && (
                <span className="badge bg-blue-100 dark:bg-blue-800/40 text-blue-700 dark:text-blue-300">
                  Kendi anahtarın
                </span>
              )}
              <span className="badge bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">Hazır</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
