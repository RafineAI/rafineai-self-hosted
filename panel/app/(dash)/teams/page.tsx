"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Provider, Team, TeamMember, User } from "@/lib/types";

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [showCreate, setShowCreate] = useState(false);

  // create form
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [rpm, setRpm] = useState("");
  const [quota, setQuota] = useState("");
  const [providerIds, setProviderIds] = useState<string[]>([]);

  async function refresh() {
    const [t, p, u] = await Promise.all([
      api<Team[]>("/api/teams"),
      api<Provider[]>("/api/providers"),
      api<User[]>("/api/users"),
    ]);
    setTeams(t);
    setProviders(p);
    setUsers(u);
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  async function openTeam(t: Team) {
    setSelected(t);
    setMembers(await api<TeamMember[]>(`/api/teams/${t.id}/members`));
  }

  async function createTeam() {
    if (!name.trim()) return;
    try {
      await api("/api/teams", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          description: desc.trim(),
          rate_limit_rpm: rpm ? Number(rpm) : null,
          daily_token_quota: quota ? Number(quota) : null,
          provider_ids: providerIds,
        }),
      });
      setShowCreate(false);
      setName(""); setDesc(""); setRpm(""); setQuota(""); setProviderIds([]);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function delTeam(t: Team) {
    if (!confirm(`"${t.name}" takımı silinsin mi?`)) return;
    await api(`/api/teams/${t.id}`, { method: "DELETE" });
    if (selected?.id === t.id) setSelected(null);
    await refresh();
  }

  async function addMember(userId: string) {
    if (!selected) return;
    await api(`/api/teams/${selected.id}/members`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId, role_in_team: "member" }),
    });
    await openTeam(selected);
    await refresh();
  }

  async function removeMember(userId: string) {
    if (!selected) return;
    await api(`/api/teams/${selected.id}/members/${userId}`, { method: "DELETE" });
    await openTeam(selected);
    await refresh();
  }

  function toggleProvider(id: string) {
    setProviderIds((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id],
    );
  }

  const memberIds = new Set(members.map((m) => m.user_id));
  const nonMembers = users.filter((u) => !memberIds.has(u.id));

  return (
    <div className="flex h-screen">
      <div className="flex-1 overflow-y-auto p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="page-title mb-1">Takımlar</h1>
            <p className="text-sm text-slate-500">
              Takımlara LLM kullanım limiti ve sağlayıcı erişim yetkisi verin.
            </p>
          </div>
          <button className="btn" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "İptal" : "+ Takım Oluştur"}
          </button>
        </div>

        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {showCreate && (
          <div className="card mb-6 space-y-3 p-5">
            <input className="input" placeholder="Takım adı" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input" placeholder="Açıklama" value={desc} onChange={(e) => setDesc(e.target.value)} />
            <div className="flex gap-3">
              <input className="input" placeholder="İstek/dakika (boş=miras, 0=sınırsız)" value={rpm} onChange={(e) => setRpm(e.target.value)} />
              <input className="input" placeholder="Günlük token (boş=miras, 0=sınırsız)" value={quota} onChange={(e) => setQuota(e.target.value)} />
            </div>
            <div>
              <p className="mb-1 text-sm font-medium">İzinli sağlayıcılar</p>
              <div className="flex flex-wrap gap-2">
                {providers.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => toggleProvider(p.id)}
                    className={`badge border px-2.5 py-1 ${
                      providerIds.includes(p.id)
                        ? "border-brand bg-brand/10 text-brand"
                        : "border-slate-300 text-slate-500"
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Hiçbiri seçilmezse takım kısıtlama getirmez. Bir sağlayıcı en az bir takıma atanınca yalnızca o takımlar kullanabilir.
              </p>
            </div>
            <button className="btn" onClick={createTeam}>Oluştur</button>
          </div>
        )}

        <div className="card divide-y divide-slate-100">
          {teams.length === 0 && <p className="p-8 text-center text-sm text-slate-400">Henüz takım yok.</p>}
          {teams.map((t) => (
            <div
              key={t.id}
              className={`flex items-center gap-3 p-4 hover:bg-slate-50 ${selected?.id === t.id ? "bg-slate-50" : ""}`}
            >
              <button className="flex-1 text-left" onClick={() => openTeam(t)}>
                <p className="font-medium text-slate-800">{t.name}</p>
                <p className="text-xs text-slate-400">
                  {t.member_count} üye · {t.provider_ids.length} sağlayıcı ·{" "}
                  {t.rate_limit_rpm == null ? "RPM: miras" : `RPM: ${t.rate_limit_rpm || "∞"}`} ·{" "}
                  {t.daily_token_quota == null ? "kota: miras" : `kota: ${t.daily_token_quota || "∞"}`}
                </p>
              </button>
              <button className="btn-ghost text-sm" onClick={() => openTeam(t)}>Yönet</button>
              <button className="btn-ghost text-sm text-red-600" onClick={() => delTeam(t)}>Sil</button>
            </div>
          ))}
        </div>
      </div>

      {/* Member management panel */}
      {selected && (
        <div className="flex w-96 flex-col border-l border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
            <span className="truncate font-medium">{selected.name} — Üyeler</span>
            <button className="btn-ghost text-sm" onClick={() => setSelected(null)}>Kapat</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Üyeler</p>
            {members.length === 0 && <p className="mb-4 text-sm text-slate-400">Üye yok.</p>}
            {members.map((m) => (
              <div key={m.user_id} className="mb-1 flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-slate-50">
                <span className="text-sm">{m.email}</span>
                <button className="text-xs text-red-600" onClick={() => removeMember(m.user_id)}>çıkar</button>
              </div>
            ))}

            <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">Ekle</p>
            {nonMembers.map((u) => (
              <div key={u.id} className="mb-1 flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-slate-50">
                <span className="text-sm text-slate-600">{u.email}</span>
                <button className="text-xs text-brand" onClick={() => addMember(u.id)}>+ ekle</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
