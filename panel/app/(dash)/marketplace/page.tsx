"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getRole } from "@/lib/api";
import type { MarketplaceApp } from "@/lib/types";

// Tools that open a dedicated page once enabled.
const TOOL_LINKS: Record<string, string> = {
  github: "/tools/github",
  slack: "/tools/slack",
  sentry: "/tools/sentry",
  api_client: "/tools/api-client",
  swagger: "/tools/swagger",
  finetune: "/tools/finetune",
};

export default function MarketplacePage() {
  const [apps, setApps] = useState<MarketplaceApp[]>([]);
  const [error, setError] = useState("");
  const [configuring, setConfiguring] = useState<MarketplaceApp | null>(null);
  const [step, setStep] = useState<"guide" | "form">("form");
  const [form, setForm] = useState<Record<string, string>>({});
  const isAdmin = getRole() === "owner" || getRole() === "admin";

  async function refresh() {
    setApps(await api<MarketplaceApp[]>("/api/marketplace"));
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  async function openConfig(app: MarketplaceApp) {
    setForm({});
    if (app.installed) {
      try {
        const cfg = await api<Record<string, string>>(`/api/marketplace/${app.slug}/config`);
        setForm(cfg);
      } catch { /* ignore */ }
    }
    // Guided setup (step-by-step + console link) when the app declares a guide,
    // mirroring the "Bağlantılarım" LLM connection flow; otherwise go straight
    // to the config form.
    setStep(app.guide ? "guide" : "form");
    setConfiguring(app);
  }

  function closeConfig() {
    setConfiguring(null);
    setForm({});
  }

  async function install(app: MarketplaceApp) {
    try {
      await api(`/api/marketplace/${app.slug}/install`, {
        method: "POST",
        body: JSON.stringify({ config: form }),
      });
      closeConfig();
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function quickInstall(app: MarketplaceApp) {
    // No-config tools install in one click.
    try {
      await api(`/api/marketplace/${app.slug}/install`, {
        method: "POST",
        body: JSON.stringify({ config: {} }),
      });
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function toggle(app: MarketplaceApp) {
    await api(`/api/marketplace/${app.slug}/toggle`, {
      method: "POST",
      body: JSON.stringify({ enabled: !app.enabled }),
    });
    await refresh();
  }

  async function uninstall(app: MarketplaceApp) {
    if (!confirm(`"${app.name}" kaldırılsın mı?`)) return;
    await api(`/api/marketplace/${app.slug}`, { method: "DELETE" });
    await refresh();
  }

  const categories = Array.from(new Set(apps.map((a) => a.category)));

  return (
    <div className="h-screen overflow-y-auto p-8">
      <h1 className="page-title mb-1">Marketplace</h1>
      <p className="mb-6 text-sm text-slate-500">
        Entegrasyonları kurun: GitHub, Slack, Sentry, API Client, Swagger ve Fine-tuning.
      </p>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {categories.map((cat) => (
        <div key={cat} className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">{cat}</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {apps.filter((a) => a.category === cat).map((app) => (
              <div key={app.slug} className="card flex flex-col p-5">
                <div className="mb-2 flex items-center gap-3">
                  <span className="text-3xl">{app.icon}</span>
                  <div>
                    <p className="font-semibold">{app.name}</p>
                    {app.installed && (
                      <span className={`badge ${app.enabled ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                        {app.enabled ? "Kurulu" : "Devre dışı"}
                      </span>
                    )}
                  </div>
                </div>
                <p className="mb-4 flex-1 text-sm text-slate-500">{app.description}</p>

                <div className="flex flex-wrap gap-2">
                  {app.installed && app.enabled && TOOL_LINKS[app.slug] && (
                    <Link href={TOOL_LINKS[app.slug]} className="btn text-sm">Aç</Link>
                  )}
                  {isAdmin && !app.installed && app.needs_config && (
                    <button className="btn text-sm" onClick={() => openConfig(app)}>Kur</button>
                  )}
                  {isAdmin && !app.installed && !app.needs_config && (
                    <button className="btn text-sm" onClick={() => quickInstall(app)}>Kur</button>
                  )}
                  {isAdmin && app.installed && (
                    <>
                      {app.needs_config && (
                        <button className="btn-ghost text-sm" onClick={() => openConfig(app)}>Ayarla</button>
                      )}
                      <button className="btn-ghost text-sm" onClick={() => toggle(app)}>
                        {app.enabled ? "Devre dışı bırak" : "Etkinleştir"}
                      </button>
                      <button className="btn-ghost text-sm text-red-600" onClick={() => uninstall(app)}>Kaldır</button>
                    </>
                  )}
                  {!isAdmin && !app.installed && (
                    <span className="text-xs text-slate-400">Yönetici kurmalı</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Config modal — guided setup (step-by-step + console link) then form,
          mirroring the "Bağlantılarım" LLM connection flow. */}
      {configuring && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeConfig}>
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-700 px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{configuring.icon}</span>
                <div>
                  <p className="font-semibold text-slate-800 dark:text-slate-100">{configuring.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {configuring.guide?.subtitle ?? "Yapılandırma"}
                  </p>
                </div>
              </div>
              <button
                onClick={closeConfig}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="p-5">
              {step === "guide" && configuring.guide ? (
                <>
                  {/* Step-by-step guide */}
                  <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
                    Bağlantı bilgilerini almak için şu adımları izle:
                  </p>
                  <ol className="mb-5 space-y-3">
                    {configuring.guide.steps.map((s, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/10 dark:bg-brand/20 text-xs font-bold text-brand">
                          {i + 1}
                        </span>
                        <span className="text-sm text-slate-700 dark:text-slate-300">{s}</span>
                      </li>
                    ))}
                  </ol>
                  <a
                    href={configuring.guide.console_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mb-4 flex items-center gap-2 rounded-xl border border-brand/30 dark:border-brand/40 bg-brand/5 dark:bg-brand/10 px-4 py-3 text-sm font-medium text-brand hover:bg-brand/10 dark:hover:bg-brand/20 transition"
                  >
                    <span className="text-base">🔗</span>
                    <span>{configuring.guide.console_label}</span>
                    <span className="ml-auto text-brand/60 text-xs">↗</span>
                  </a>
                  <button className="btn w-full" onClick={() => setStep("form")}>
                    Bilgileri aldım, devam et →
                  </button>
                </>
              ) : (
                <>
                  {/* Config fields */}
                  <div className="space-y-3">
                    {configuring.config_fields.map((f) => (
                      <div key={f.key}>
                        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                          {f.label}{f.optional && <span className="text-slate-400"> (opsiyonel)</span>}
                        </label>
                        <input
                          type={f.secret ? "password" : "text"}
                          className="input"
                          placeholder={f.placeholder}
                          value={form[f.key] ?? ""}
                          onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 flex gap-2">
                    {configuring.guide ? (
                      <button className="btn-ghost flex-1 text-sm" onClick={() => setStep("guide")}>
                        ← Geri
                      </button>
                    ) : (
                      <button className="btn-ghost flex-1 text-sm" onClick={closeConfig}>
                        İptal
                      </button>
                    )}
                    <button className="btn flex-1" onClick={() => install(configuring)}>
                      Kaydet
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
