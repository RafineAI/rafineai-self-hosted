"""One-shot LLM completion helper used by tools (API Client explain, etc.).

Picks the first provider the calling user can actually use (own BYOK key, a
shared key, or a connected OAuth2 provider), mints a short-lived gateway key,
and returns the assistant text. Tools reuse this instead of duplicating the
gateway plumbing.
"""
from __future__ import annotations

import httpx

from . import db, signing
from .config import Settings
from .deps import CurrentUser


async def _pick_provider(user: CurrentUser) -> dict | None:
    rows = await db.pool().fetch(
        """
        SELECT id::text AS id, type, default_model, auth_mode,
               (api_key_encrypted IS NOT NULL AND api_key_encrypted <> '') AS has_api_key
        FROM llm_providers WHERE is_active = TRUE ORDER BY created_at
        """
    )
    own = {r["provider_type"] for r in await db.pool().fetch(
        "SELECT provider_type FROM user_own_keys WHERE user_id = $1", user.id
    )}
    connected = {r["pid"] for r in await db.pool().fetch(
        "SELECT provider_id::text AS pid FROM user_provider_tokens WHERE user_id = $1", user.id
    )}
    for r in rows:
        usable = (
            r["type"] in own
            or (r["auth_mode"] == "api_key" and r["has_api_key"])
            or (r["auth_mode"] == "oauth2" and r["id"] in connected)
        )
        if usable:
            return dict(r)
    return None


async def quick_complete(user: CurrentUser, prompt: str, settings: Settings) -> str:
    """Run a single completion and return the assistant text (or a friendly
    Turkish error message). Never raises for provider/credential issues."""
    provider = await _pick_provider(user)
    if not provider:
        return "Kullanılabilir bir LLM sağlayıcısı yok. Bağlantılarım'dan kendi anahtarınızı ekleyin."

    gw_key = signing.sign(
        settings.rafine_master_key, user_id=user.id,
        key_id=f"user:{user.id}", provider_id=provider["id"],
    )
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{settings.gateway_url}/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {gw_key}",
                    "X-Rafine-Provider": provider["id"],
                },
                json={
                    "model": provider["default_model"],
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
    except httpx.HTTPError:
        return "LLM gateway'e ulaşılamadı."
    if resp.status_code >= 400:
        return "LLM isteği başarısız oldu (sağlayıcı/kota hatası olabilir)."
    try:
        return resp.json()["choices"][0]["message"]["content"]
    except Exception:  # noqa: BLE001
        return "Yanıt çözümlenemedi."
