"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { User, UserCreateResult } from "@/lib/types";

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [rpm, setRpm] = useState("");
  const [daily, setDaily] = useState("");
  const [error, setError] = useState("");
  const [created, setCreated] = useState<UserCreateResult | null>(null);

  async function refresh() {
    setUsers(await api<User[]>("/api/users"));
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setCreated(null);
    try {
      const res = await api<UserCreateResult>("/api/users", {
        method: "POST",
        // Omit password to let the system generate a temporary one.
        body: JSON.stringify({
          email,
          role,
          ...(password ? { password } : {}),
          ...(rpm ? { rate_limit_rpm: parseInt(rpm, 10) } : {}),
          ...(daily ? { daily_token_quota: parseInt(daily, 10) } : {}),
        }),
      });
      if (res.generated_password) setCreated(res);
      setEmail("");
      setPassword("");
      setRole("user");
      setRpm("");
      setDaily("");
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function toggleActive(u: User) {
    await api(`/api/users/${u.id}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: !u.is_active }),
    });
    refresh();
  }

  async function remove(u: User) {
    if (!confirm(`Delete ${u.email}?`)) return;
    try {
      await api(`/api/users/${u.id}`, { method: "DELETE" });
      refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="h-screen overflow-y-auto p-8">
      <h1 className="mb-6 text-2xl font-bold">User Management</h1>

      <form onSubmit={create} className="card mb-8 flex flex-wrap items-end gap-3 p-4">
        <div className="flex-1">
          <label className="mb-1 block text-sm font-medium">Email</label>
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-sm font-medium">
            Password <span className="text-slate-400">(blank = auto-generate)</span>
          </label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="leave blank to generate"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <details className="w-full rounded-md border border-slate-200 p-3">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            Rate limits (optional)
          </summary>
          <div className="mt-3 flex flex-wrap gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Requests / min</label>
              <input className="input" type="number" min={0} placeholder="default"
                value={rpm} onChange={(e) => setRpm(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Daily token quota</label>
              <input className="input" type="number" min={0} placeholder="default"
                value={daily} onChange={(e) => setDaily(e.target.value)} />
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">Blank = gateway default · 0 = unlimited.</p>
        </details>

        <button className="btn" type="submit">
          Add user
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {created && (
        <div className="mb-6 rounded-md border border-green-300 bg-green-50 p-4 text-sm">
          <p className="font-medium text-green-800">
            User created: {created.email}
          </p>
          <p className="mt-1 text-green-700">
            Temporary password (share it with the user — they must change it on first
            sign-in):
          </p>
          <code className="mt-2 inline-block rounded bg-white px-3 py-1.5 font-mono text-base">
            {created.generated_password}
          </code>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Limits (rpm / daily)</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="px-4 py-3">{u.email}</td>
                <td className="px-4 py-3">{u.role}</td>
                <td className="px-4 py-3">
                  <span className={u.is_active ? "text-green-600" : "text-slate-400"}>
                    {u.is_active ? "active" : "disabled"}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {u.rate_limit_rpm ?? "—"} / {u.daily_token_quota ?? "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  {u.role !== "owner" && (
                    <div className="flex justify-end gap-2">
                      <button className="btn-ghost" onClick={() => toggleActive(u)}>
                        {u.is_active ? "Disable" : "Enable"}
                      </button>
                      <button className="btn-ghost" onClick={() => remove(u)}>
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
