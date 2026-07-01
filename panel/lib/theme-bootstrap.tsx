"use client";

import { useEffect } from "react";
import { api } from "./api";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

export function ThemeBootstrap() {
  useEffect(() => {
    // Apply saved dark mode preference immediately
    const dark = localStorage.getItem("rafine_dark") === "1";
    document.documentElement.classList.toggle("dark", dark);

    // Fetch server-side theme setting
    fetch(`${BASE}/api/settings`)
      .then((r) => r.json())
      .then((s: Record<string, string>) => {
        const theme = s.chat_theme ?? "default";
        document.documentElement.setAttribute("data-theme", theme);
        // Cache locally so pages can read it
        localStorage.setItem("rafine_theme", theme);
      })
      .catch(() => {});
  }, []);

  return null;
}

export function toggleDark() {
  const isDark = document.documentElement.classList.toggle("dark");
  localStorage.setItem("rafine_dark", isDark ? "1" : "0");
  return isDark;
}

export function getDark(): boolean {
  if (typeof window === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}
