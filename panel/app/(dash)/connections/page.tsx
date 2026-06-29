"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Provider } from "@/lib/types";

export default function ConnectionsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [error, setError] = useState("");
  const [justConnected, setJustConnected] = useState(false);

  async function refresh() {
    setProviders(await api<Provider[]>("/api/providers"));
  }
  useEffect(() => {
    if (typeof window !== "undefined") {
      setJustConnected(new URLSearchParams(window.location.search).get("connected") === "1");
    }
    refresh().catch((e) => setError(e.message));
  }, []);

  async function connect(p: Provider) {
    try {
      const { auth_url } = await api<{ auth_url: string }>(
        `/api/providers/${p.id}/oauth/start`,
      );
      window.location.href = auth_url;
    } catch (e: any) {
      setError(e.message);
    }
  }

  const oauthProviders = providers.filter((p) => p.auth_mode === "oauth2");
  const sharedProviders = providers.filter((p) => p.auth_mode === "api_key" && p.is_active);

  return (
    <div className="h-screen overflow-y-auto p-8">
      <h1 className="page-title mb-1">Bağlantılarım</h1>
      <p className="mb-6 text-sm text-slate-500">
        Kendi hesabınızla (ör. Google / e-posta ile OAuth2) bir LLM sağlayıcısına
        bağlanın. Bağlandıktan sonra sohbet ekranında model olarak seçebilirsiniz.
      </p>

      {justConnected && (
        <div className="mb-6 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">
          ✅ Bağlantı başarıyla tamamlandı.
        </div>
      )}
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <h2 className="mb-2 font-semibold">Bağlanabilecek sağlayıcılar (OAuth2)</h2>
      <div className="mb-8 space-y-3">
        {oauthProviders.length === 0 && (
          <div className="card p-6 text-sm text-slate-400">
            Yöneticiniz henüz OAuth2 ile bağlanılabilen bir sağlayıcı tanımlamamış.
          </div>
        )}
        {oauthProviders.map((p) => (
          <div key={p.id} className="card flex items-center justify-between p-4">
            <div>
              <p className="font-medium">{p.name}</p>
              <p className="text-xs text-slate-500">
                {p.type} · {p.default_model} ·{" "}
                {p.connected ? (
                  <span className="text-green-600">bağlı</span>
                ) : (
                  <span className="text-slate-400">bağlı değil</span>
                )}
              </p>
            </div>
            {p.connected ? (
              <span className="badge bg-green-100 text-green-700">Bağlı</span>
            ) : (
              <button className="btn" onClick={() => connect(p)}>Bağlan</button>
            )}
          </div>
        ))}
      </div>

      <h2 className="mb-2 font-semibold">Hazır sağlayıcılar (yönetici anahtarı)</h2>
      <p className="mb-2 text-xs text-slate-500">
        Bunlar yöneticiniz tarafından sağlanır; bağlanmanıza gerek yoktur, doğrudan
        sohbet ekranından kullanabilirsiniz.
      </p>
      <div className="space-y-3">
        {sharedProviders.length === 0 && (
          <div className="card p-6 text-sm text-slate-400">Hazır sağlayıcı yok.</div>
        )}
        {sharedProviders.map((p) => (
          <div key={p.id} className="card flex items-center justify-between p-4">
            <div>
              <p className="font-medium">{p.name}</p>
              <p className="text-xs text-slate-500">{p.type} · {p.default_model}</p>
            </div>
            <span className="badge bg-slate-100 text-slate-600">Hazır</span>
          </div>
        ))}
      </div>
    </div>
  );
}
