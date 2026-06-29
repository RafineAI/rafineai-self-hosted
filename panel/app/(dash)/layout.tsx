"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { api, clearSession, getRole, getToken } from "@/lib/api";
import type { User } from "@/lib/types";

const NAV = [
  { href: "/chat", label: "Chat", icon: "💬", adminOnly: false },
  { href: "/providers", label: "LLM Providers", icon: "🔌", adminOnly: true },
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

  useEffect(() => {
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    // Force a password change on first sign-in for system-generated accounts.
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
      <aside className="flex w-60 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-white">
            R
          </div>
          <span className="text-lg font-bold tracking-tight">RafineAI</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {items.map((n) => {
            const active = pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active ? "bg-brand text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                <span aria-hidden>{n.icon}</span>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-slate-200 p-3">
          <div className="mb-2 px-1">
            <p className="truncate text-sm font-medium text-slate-700">{email}</p>
            <p className="text-xs uppercase tracking-wide text-slate-400">{role}</p>
          </div>
          <button onClick={logout} className="btn-ghost w-full">
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-hidden bg-slate-50">{children}</main>
    </div>
  );
}
