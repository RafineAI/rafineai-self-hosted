"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { api, clearSession, getRole, getToken } from "@/lib/api";
import type { User } from "@/lib/types";

const NAV = [
  { href: "/chat", label: "Chat", icon: "💬", adminOnly: false },
  { href: "/documents", label: "Belgelerim", icon: "📁", adminOnly: false },
  { href: "/knowledge", label: "Bilgi Tabanı", icon: "📚", adminOnly: false },
  { href: "/connections", label: "Bağlantılarım", icon: "🔗", adminOnly: false },
  { href: "/marketplace", label: "Marketplace", icon: "🧩", adminOnly: false },
  { href: "/dashboard", label: "Dashboard", icon: "📊", adminOnly: true },
  { href: "/providers", label: "LLM Providers", icon: "🔌", adminOnly: true },
  { href: "/teams", label: "Teams", icon: "🧑‍🤝‍🧑", adminOnly: true },
  { href: "/users", label: "Users", icon: "👥", adminOnly: true },
  { href: "/policy", label: "Policy Rules", icon: "🛡️", adminOnly: true },
  { href: "/alerts", label: "Alerts", icon: "🔔", adminOnly: true },
  { href: "/audit", label: "Audit Logs", icon: "📋", adminOnly: true },
];

export default function DashLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [email, setEmail] = useState<string>("");
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    api<User>("/api/auth/me")
      .then((me) => {
        if (me.must_change_password) {
          router.replace("/change-password");
          return;
        }
        setEmail(me.email);
        setRole(getRole());
        setReady(true);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  if (!ready) return null;

  const isAdmin = role === "owner" || role === "admin";
  const items = NAV.filter((n) => !n.adminOnly || isAdmin);

  function logout() {
    clearSession();
    router.replace("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside
        className={`relative flex flex-col border-r border-slate-200 bg-white transition-all duration-200 ${
          open ? "w-60" : "w-14"
        }`}
      >
        {/* Logo + toggle button */}
        <div className="flex items-center border-b border-slate-200 px-3 py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">
            R
          </div>
          {open && (
            <span className="ml-2 flex-1 text-lg font-bold tracking-tight">RafineAI</span>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            title={open ? "Menüyü kapat" : "Menüyü aç"}
            className={`ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition ${
              open ? "" : "mx-auto"
            }`}
          >
            {open ? (
              /* chevron left */
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
              </svg>
            ) : (
              /* chevron right */
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
              </svg>
            )}
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 space-y-1 p-2">
          {items.map((n) => {
            const active = pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                title={!open ? n.label : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-brand text-white shadow-sm"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                } ${!open ? "justify-center" : ""}`}
              >
                <span className="shrink-0 text-base" aria-hidden>{n.icon}</span>
                {open && n.label}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-slate-200 p-2">
          {open ? (
            <>
              <div className="mb-2 px-1">
                <p className="truncate text-sm font-medium text-slate-700">{email}</p>
                <p className="text-xs uppercase tracking-wide text-slate-400">{role}</p>
              </div>
              <button onClick={logout} className="btn-ghost w-full">
                Sign out
              </button>
            </>
          ) : (
            <button
              onClick={logout}
              title="Sign out"
              className="flex w-full items-center justify-center rounded-md py-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 015.25 2h5.5A2.25 2.25 0 0113 4.25v2a.75.75 0 01-1.5 0v-2a.75.75 0 00-.75-.75h-5.5a.75.75 0 00-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 00.75-.75v-2a.75.75 0 011.5 0v2A2.25 2.25 0 0110.75 18h-5.5A2.25 2.25 0 013 15.75V4.25z" clipRule="evenodd" />
                <path fillRule="evenodd" d="M19 10a.75.75 0 00-.75-.75H8.704l1.048-1.08a.75.75 0 10-1.004-1.118l-2.5 2.572a.75.75 0 000 1.052l2.5 2.572a.75.75 0 101.004-1.118L8.704 10.75H18.25A.75.75 0 0019 10z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-hidden bg-slate-50">{children}</main>
    </div>
  );
}
