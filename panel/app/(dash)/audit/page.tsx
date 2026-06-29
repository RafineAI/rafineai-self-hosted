"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AuditRow } from "@/lib/types";

export default function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<AuditRow[]>("/api/audit?limit=200")
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="h-screen overflow-y-auto p-8">
      <h1 className="page-title mb-6">Audit Logs</h1>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Model</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Tokens (in/out)</th>
              <th className="px-3 py-2">Latency</th>
              <th className="px-3 py-2">Policies</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="whitespace-nowrap px-3 py-2 text-slate-500">
                  {new Date(r.created_at).toLocaleString()}
                </td>
                <td className="px-3 py-2">{r.model ?? "—"}</td>
                <td className="px-3 py-2">
                  <span className={r.status_code >= 400 ? "text-red-600" : "text-green-600"}>
                    {r.status_code}
                  </span>
                </td>
                <td className="px-3 py-2">
                  {r.request_tokens}/{r.response_tokens}
                </td>
                <td className="px-3 py-2">{r.latency_ms} ms</td>
                <td className="px-3 py-2">
                  {r.applied_policies?.length ? (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                      {r.applied_policies.join(", ")}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !error && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  No audit records yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
