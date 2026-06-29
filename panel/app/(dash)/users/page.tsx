"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [error, setError] = useState("");

  async function refresh() {
    setUsers(await api<User[]>("/api/users"));
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify({ email, password, role }),
      });
      setEmail("");
      setPassword("");
      setRole("user");
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
          <label className="mb-1 block text-sm font-medium">Password</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Role</label>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>
        </div>
        <button className="btn" type="submit">
          Add user
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
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
