"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { api, clearSession, getRole, getToken } from "@/lib/api";
import type { User } from "@/lib/types";

const NAV = [
  { href: "/chat", label: "Chat", adminOnly: false },
  { href: "/providers", label: "LLM Providers", adminOnly: true },
  { href: "/users", label: "Users", adminOnly: true },
  { href: "/audit", label: "Audit Logs", adminOnly: true },
];

export default function DashLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [role, setRole] = useState<string | null>(null);

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
        <div className="border-b border-slate-200 px-6 py-5">
          <span className="text-xl font-bold text-brand">RafineAI</span>
          <p className="mt-0.5 text-xs uppercase tracking-wide text-slate-400">{role}</p>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {items.map((n) => {
            const active = pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`block rounded-md px-3 py-2 text-sm font-medium ${
                  active ? "bg-brand text-white" : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <button onClick={logout} className="m-3 btn-ghost">
          Sign out
        </button>
      </aside>
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
