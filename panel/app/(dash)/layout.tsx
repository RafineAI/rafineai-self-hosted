"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { api, clearSession, getRole, getToken } from "@/lib/api";
import { toggleDark, getDark } from "@/lib/theme-bootstrap";
import { useSettings } from "@/lib/settings-context";
import type { User } from "@/lib/types";

const ADMIN_NAV = [
  { href: "/dashboard",     label: "Dashboard",      icon: "📊" },
  { href: "/providers",     label: "LLM Providers",  icon: "🔌" },
  { href: "/teams",         label: "Teams",          icon: "🧑‍🤝‍🧑" },
  { href: "/users",         label: "Users",           icon: "👥" },
  { href: "/policy",        label: "Policy Rules",    icon: "🛡️" },
  { href: "/alerts",        label: "Alerts",          icon: "🔔" },
  { href: "/documents",     label: "Belgelerim",      icon: "📁" },
  { href: "/knowledge",     label: "Bilgi Tabanı",    icon: "📚" },
  { href: "/marketplace",   label: "Marketplace",     icon: "🧩" },
  { href: "/conversations", label: "Chat Geçmişi",    icon: "📜" },
  { href: "/audit",         label: "Audit Logs",      icon: "📋" },
  { href: "/settings",      label: "Ayarlar",         icon: "⚙️" },
];

function DarkToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(getDark()); }, []);
  return (
    <button
      onClick={() => setDark(toggleDark())}
      title={dark ? "Açık tema" : "Koyu tema"}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 dark:text-slate-400 transition text-base"
    >
      {dark ? "☀️" : "🌙"}
    </button>
  );
}

export default function DashLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [email, setEmail] = useState<string>("");
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!getToken()) { router.replace("/login"); return; }
    api<User>("/api/auth/me")
      .then((me) => {
        if (me.must_change_password) { router.replace("/change-password"); return; }
        setEmail(me.email);
        setRole(getRole());
        setReady(true);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  const s = useSettings();

  if (!ready) return null;

  const isAdmin = role === "owner" || role === "admin";

  function logout() {
    clearSession();
    router.replace("/login");
  }

  // Non-admin: no sidebar — chat page manages its own full-screen layout
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-slate-100 dark:bg-slate-950">
        {children}
      </div>
    );
  }

  // Admin: full sidebar layout
  return (
    <div className="flex min-h-screen dark:bg-slate-950">
      <aside
        className={`relative z-10 flex flex-col border-r border-slate-200 dark:border-white/10 bg-white/90 dark:bg-slate-900/50 dark:backdrop-blur-xl transition-all duration-200 ${
          open ? "w-56" : "w-14"
        }`}
      >
        {/* Logo + toggle */}
        <div className="flex items-center border-b border-slate-200 dark:border-white/10 px-3 py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand to-cyan-accent text-sm font-bold text-white overflow-hidden dark:shadow-glow">
            {s.app_logo_url ? (
              <img src={s.app_logo_url} alt={s.app_name} className="h-full w-full object-cover" />
            ) : (
              s.app_logo
            )}
          </div>
          {open && (
            <span className="ml-2 flex-1 text-lg font-bold tracking-tight dark:text-slate-100">{s.app_name}</span>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            className={`ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition ${open ? "" : "mx-auto"}`}
          >
            {open ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
              </svg>
            )}
          </button>
        </div>

        {/* Chat shortcut at top */}
        <div className="border-b border-slate-200 dark:border-slate-700 p-2">
          <Link
            href="/chat"
            title={!open ? "Chat" : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition ${
              pathname.startsWith("/chat")
                ? "bg-brand/15 text-brand dark:text-brand ring-1 ring-inset ring-brand/30"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            } ${!open ? "justify-center" : ""}`}
          >
            <span className="shrink-0 text-base">💬</span>
            {open && "Chat"}
          </Link>
        </div>

        {/* Admin nav */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {ADMIN_NAV.map((n) => {
            const active = pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                title={!open ? n.label : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-brand/15 text-brand dark:text-brand ring-1 ring-inset ring-brand/30"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100"
                } ${!open ? "justify-center" : ""}`}
              >
                <span className="shrink-0 text-base" aria-hidden>{n.icon}</span>
                {open && n.label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-slate-200 dark:border-slate-700 p-2">
          {open ? (
            <>
              <div className="mb-2 flex items-center justify-between px-1">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">{email}</p>
                  <p className="text-xs uppercase tracking-wide text-slate-400">{role}</p>
                </div>
                <DarkToggle />
              </div>
              <button onClick={logout} className="btn-ghost w-full text-xs">
                Çıkış
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <DarkToggle />
              <button
                onClick={logout}
                title="Çıkış"
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                  <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 015.25 2h5.5A2.25 2.25 0 0113 4.25v2a.75.75 0 01-1.5 0v-2a.75.75 0 00-.75-.75h-5.5a.75.75 0 00-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 00.75-.75v-2a.75.75 0 011.5 0v2A2.25 2.25 0 0110.75 18h-5.5A2.25 2.25 0 013 15.75V4.25z" clipRule="evenodd" />
                  <path fillRule="evenodd" d="M19 10a.75.75 0 00-.75-.75H8.704l1.048-1.08a.75.75 0 10-1.004-1.118l-2.5 2.572a.75.75 0 000 1.052l2.5 2.572a.75.75 0 101.004-1.118L8.704 10.75H18.25A.75.75 0 0019 10z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </aside>

      <main className="grid-bg flex-1 overflow-hidden bg-slate-50 dark:bg-transparent">{children}</main>
    </div>
  );
}
