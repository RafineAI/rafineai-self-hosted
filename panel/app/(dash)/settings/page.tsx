"use client";

import { useEffect, useRef, useState } from "react";
import { api, uploadFile } from "@/lib/api";
import { toggleDark, getDark } from "@/lib/theme-bootstrap";
import type { AppSettings } from "@/lib/settings-context";
import { SETTING_DEFAULTS } from "@/lib/settings-context";

const THEMES = [
  { id: "default", name: "Varsayılan", desc: "Indigo/mor",   swatch: "#4f46e5" },
  { id: "ocean",   name: "Okyanus",    desc: "Cyan/mavi",    swatch: "#0891b2" },
  { id: "forest",  name: "Orman",      desc: "Yeşil",        swatch: "#16a34a" },
  { id: "sunset",  name: "Gün Batımı", desc: "Turuncu",      swatch: "#f97316" },
  { id: "rose",    name: "Gül",        desc: "Kırmızı/pembe", swatch: "#e11d48" },
];

type SectionKey = "branding" | "chat" | "theme";

function SaveBar({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  if (status === "idle") return null;
  return (
    <span className={`text-xs font-medium ${
      status === "saving" ? "text-slate-400" :
      status === "saved"  ? "text-green-600 dark:text-green-400" :
                            "text-red-600 dark:text-red-400"
    }`}>
      {status === "saving" ? "Kaydediliyor…" : status === "saved" ? "✓ Kaydedildi" : "✗ Hata"}
    </span>
  );
}

export default function SettingsPage() {
  const [form, setForm] = useState<AppSettings>(SETTING_DEFAULTS);
  const [status, setStatus] = useState<Record<SectionKey, "idle" | "saving" | "saved" | "error">>({
    branding: "idle", chat: "idle", theme: "idle",
  });
  const [dark, setDark] = useState(false);
  const [logoStatus, setLogoStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDark(getDark());
    api<Record<string, string>>("/api/settings")
      .then((s) => setForm({ ...SETTING_DEFAULTS, ...s }))
      .catch(() => {});
  }, []);

  function field(key: keyof AppSettings) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setForm((f) => ({ ...f, [key]: e.target.value })),
    };
  }

  async function uploadLogo(file: File) {
    setLogoStatus("uploading");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { url } = await uploadFile<{ url: string }>("/api/uploads/logo", fd);
      setForm((f) => ({ ...f, app_logo_url: url }));
      setLogoStatus("done");
      setTimeout(() => setLogoStatus("idle"), 2500);
    } catch {
      setLogoStatus("error");
      setTimeout(() => setLogoStatus("idle"), 3000);
    }
  }

  async function clearLogo() {
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify({ app_logo_url: "" }) });
      setForm((f) => ({ ...f, app_logo_url: "" }));
    } catch {}
  }

  async function save(section: SectionKey, keys: (keyof AppSettings)[], overrides?: Partial<AppSettings>) {
    setStatus((s) => ({ ...s, [section]: "saving" }));
    const payload = Object.fromEntries(keys.map((k) => [k, overrides?.[k as keyof AppSettings] ?? form[k]]));
    try {
      const updated = await api<Record<string, string>>("/api/settings", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setForm((f) => ({ ...f, ...updated }));
      // Apply branding/theme changes immediately in this tab
      if ("chat_theme" in payload) {
        document.documentElement.setAttribute("data-theme", updated.chat_theme ?? "default");
        localStorage.setItem("rafine_theme", updated.chat_theme ?? "default");
      }
      setStatus((s) => ({ ...s, [section]: "saved" }));
      setTimeout(() => setStatus((s) => ({ ...s, [section]: "idle" })), 2500);
    } catch {
      setStatus((s) => ({ ...s, [section]: "error" }));
    }
  }

  return (
    <div className="h-screen overflow-y-auto p-8 dark:bg-slate-950">
      <h1 className="page-title mb-1">Ayarlar</h1>
      <p className="mb-8 text-sm text-slate-500 dark:text-slate-400">
        Uygulama görünümü ve metinleri. Kullanıcılar bu sayfayı göremez.
      </p>

      {/* ── Dark mode toggle ──────────────────────────────────────── */}
      <div className="card dark:border-slate-700 dark:bg-slate-800 mb-6 flex items-center justify-between p-5">
        <div>
          <p className="font-medium text-slate-800 dark:text-slate-200">Koyu Tema</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">Bu tarayıcıdaki görünümünüzü değiştirir.</p>
        </div>
        <button
          onClick={() => setDark(toggleDark())}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            dark ? "bg-brand" : "bg-slate-300 dark:bg-slate-600"
          }`}
        >
          <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${dark ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>

      {/* ── Branding ─────────────────────────────────────────────── */}
      <section className="card dark:border-slate-700 dark:bg-slate-800 mb-6 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-800 dark:text-slate-200">Marka Kimliği</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Uygulama adı, logo ve kısa açıklama — login ekranında ve sidebarda görünür.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <SaveBar status={status.branding} />
            <button className="btn" onClick={() => save("branding", ["app_name", "app_logo", "app_tagline"])}>
              Kaydet
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FieldRow label="Uygulama Adı" hint="Max 64 karakter">
            <input className="input" maxLength={64} {...field("app_name")} />
          </FieldRow>
          <FieldRow label="Logo Görseli" hint="PNG/JPG/SVG/WebP, maks 2 MB. Yüklenince harfin önüne geçer.">
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadLogo(file);
                e.target.value = "";
              }}
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={() => logoInputRef.current?.click()}
                disabled={logoStatus === "uploading"}
              >
                {logoStatus === "uploading" ? "Yükleniyor…" :
                 logoStatus === "done" ? "✓ Yüklendi" :
                 logoStatus === "error" ? "✗ Hata" :
                 "Görsel Seç"}
              </button>
              {form.app_logo_url ? (
                <>
                  <img
                    src={form.app_logo_url}
                    alt="Logo"
                    className="h-10 w-10 rounded-lg object-contain border border-slate-200 dark:border-slate-600"
                  />
                  <button type="button" className="text-xs text-red-500 hover:text-red-700" onClick={clearLogo}>
                    Kaldır
                  </button>
                </>
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-300 dark:border-slate-600 text-slate-400 text-xs">
                  Yok
                </div>
              )}
            </div>
          </FieldRow>
          <FieldRow label="Logo Harfi / Emoji" hint="Görsel yokken gösterilir, 1-4 karakter">
            <div className="flex items-center gap-3">
              <input className="input" maxLength={4} {...field("app_logo")} />
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand text-lg font-bold text-white shadow">
                {form.app_logo || "?"}
              </div>
            </div>
          </FieldRow>
          <FieldRow label="Alt Başlık" hint="Login ekranında, ad altında görünür">
            <input className="input" maxLength={128} {...field("app_tagline")} />
          </FieldRow>
        </div>

        {/* Live preview */}
        <div className="mt-4 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Önizleme — Login</p>
          <div className="flex flex-col items-center gap-1">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand text-xl font-bold text-white shadow overflow-hidden">
              {form.app_logo_url ? (
                <img src={form.app_logo_url} alt="Logo" className="h-full w-full object-cover" />
              ) : (
                form.app_logo || "?"
              )}
            </div>
            <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{form.app_name}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">{form.app_tagline}</p>
          </div>
        </div>
      </section>

      {/* ── Chat UI ──────────────────────────────────────────────── */}
      <section className="card dark:border-slate-700 dark:bg-slate-800 mb-6 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-800 dark:text-slate-200">Chat Arayüzü</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Kullanıcının chat ekranında gördüğü metinler.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <SaveBar status={status.chat} />
            <button className="btn" onClick={() => save("chat", ["chat_welcome_title", "chat_welcome_subtitle", "chat_placeholder", "chat_send_label"])}>
              Kaydet
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FieldRow label="Karşılama Başlığı" hint="Sohbet başlamadan önce orta ekranda görünür">
            <input className="input" maxLength={128} {...field("chat_welcome_title")} />
          </FieldRow>
          <FieldRow label="Karşılama Alt Metni" hint="Başlığın altındaki yönlendirme metni">
            <input className="input" maxLength={256} {...field("chat_welcome_subtitle")} />
          </FieldRow>
          <FieldRow label="Mesaj Kutusu Placeholder" hint="Input alanında görünen ipucu metni">
            <input className="input" maxLength={256} {...field("chat_placeholder")} />
          </FieldRow>
          <FieldRow label="Gönder Butonu Etiketi" hint="Max 32 karakter">
            <div className="flex items-center gap-3">
              <input className="input" maxLength={32} {...field("chat_send_label")} />
              <button className="btn shrink-0 pointer-events-none opacity-80">{form.chat_send_label || "Gönder"}</button>
            </div>
          </FieldRow>
        </div>

        {/* Live preview */}
        <div className="mt-4 rounded-xl border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">Önizleme — Boş Chat</p>
          <div className="flex flex-col items-center gap-1 py-2 text-center text-slate-400 dark:text-slate-500">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 dark:bg-brand/20 text-2xl">💬</div>
            <p className="font-medium text-slate-600 dark:text-slate-300">{form.chat_welcome_title}</p>
            <p className="text-sm">{form.chat_welcome_subtitle}</p>
          </div>
        </div>
      </section>

      {/* ── Color Theme ──────────────────────────────────────────── */}
      <section className="card dark:border-slate-700 dark:bg-slate-800 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-800 dark:text-slate-200">Renk Teması</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Tüm kullanıcılara uygulanan marka rengi.
            </p>
          </div>
          <SaveBar status={status.theme} />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setForm((f) => ({ ...f, chat_theme: t.id }));
                save("theme", ["chat_theme"], { chat_theme: t.id });
              }}
              className={`group flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition ${
                form.chat_theme === t.id
                  ? "border-slate-800 dark:border-slate-200 shadow-md"
                  : "border-slate-200 dark:border-slate-600 hover:border-slate-400 dark:hover:border-slate-400"
              }`}
            >
              <div
                className="h-10 w-10 rounded-full shadow"
                style={{ backgroundColor: t.swatch }}
              />
              <div className="w-full space-y-0.5">
                <div className="h-1.5 w-3/4 rounded-full opacity-80" style={{ backgroundColor: t.swatch }} />
                <div className="h-1.5 w-1/2 rounded-full bg-slate-200 dark:bg-slate-600" />
                <div className="ml-auto h-1.5 w-2/3 rounded-full opacity-80" style={{ backgroundColor: t.swatch }} />
              </div>
              <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{t.name}</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">{t.desc}</p>
              {form.chat_theme === t.id && (
                <span className="text-xs font-bold text-brand">✓ Aktif</span>
              )}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  );
}
