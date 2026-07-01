"use client";

import { createContext, useContext, useEffect, useState } from "react";

export interface AppSettings {
  chat_theme: string;
  app_name: string;
  app_logo: string;
  app_logo_url: string;
  app_tagline: string;
  chat_welcome_title: string;
  chat_welcome_subtitle: string;
  chat_placeholder: string;
  chat_send_label: string;
}

export const SETTING_DEFAULTS: AppSettings = {
  chat_theme:           "default",
  app_name:             "RafineAI",
  app_logo:             "R",
  app_logo_url:         "",
  app_tagline:          "AI Gateway",
  chat_welcome_title:   "Yeni bir sohbet başlat",
  chat_welcome_subtitle:"Yukarıdan modeli seç, mesajını yaz.",
  chat_placeholder:     "Mesajını yaz…  (Enter ile gönder, Shift+Enter yeni satır)",
  chat_send_label:      "Gönder",
};

const SettingsCtx = createContext<AppSettings>(SETTING_DEFAULTS);

export function useSettings(): AppSettings {
  return useContext(SettingsCtx);
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(SETTING_DEFAULTS);

  useEffect(() => {
    // Apply saved dark mode preference before first paint
    const dark = localStorage.getItem("rafine_dark") === "1";
    document.documentElement.classList.toggle("dark", dark);

    // Load server-side settings (theme + branding)
    fetch(`${BASE}/api/settings`)
      .then((r) => r.json())
      .then((s: Record<string, string>) => {
        const merged: AppSettings = { ...SETTING_DEFAULTS, ...s };
        setSettings(merged);
        document.documentElement.setAttribute("data-theme", merged.chat_theme);
        localStorage.setItem("rafine_theme", merged.chat_theme);
      })
      .catch(() => {
        // Fallback: apply cached theme
        const cached = localStorage.getItem("rafine_theme") ?? "default";
        document.documentElement.setAttribute("data-theme", cached);
      });
  }, []);

  return (
    <SettingsCtx.Provider value={settings}>
      {children}
    </SettingsCtx.Provider>
  );
}
