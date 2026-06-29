"""LLM provider management. Reads allowed to any user; writes are admin-only."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from .. import crypto, db
from ..config import Settings, get_settings
from ..deps import CurrentUser, get_current_user, require_admin
from ..schemas import ProviderCreate, ProviderOut, ProviderUpdate

router = APIRouter(prefix="/api/providers", tags=["providers"])


async def _connected_set(user_id: str) -> set[str]:
    rows = await db.pool().fetch(
        "SELECT provider_id::text AS pid FROM user_provider_tokens WHERE user_id = $1",
        user_id,
    )
    return {r["pid"] for r in rows}


async def _own_key_types(user_id: str) -> set[str]:
    rows = await db.pool().fetch(
        "SELECT provider_type FROM user_own_keys WHERE user_id = $1",
        user_id,
    )
    return {r["provider_type"] for r in rows}


@router.get("", response_model=list[ProviderOut])
async def list_providers(user: CurrentUser = Depends(get_current_user)):
    rows = await db.pool().fetch(
        """
        SELECT id::text AS id, name, type, auth_mode,
               (api_key_encrypted IS NOT NULL AND api_key_encrypted <> '') AS has_api_key,
               base_url, default_model, is_active,
               light_model, heavy_model, route_threshold_tokens
        FROM llm_providers ORDER BY created_at
        """
    )
    connected, own_keys = await _connected_set(user.id), await _own_key_types(user.id)
    return [
        ProviderOut(
            **dict(r),
            connected=(r["id"] in connected),
            own_key=(r["type"] in own_keys),
        )
        for r in rows
    ]


@router.post("", response_model=ProviderOut, status_code=status.HTTP_201_CREATED)
async def create_provider(
    body: ProviderCreate,
    _: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    api_key_enc = (
        crypto.encrypt(settings.rafine_master_key, body.api_key)
        if body.api_key
        else None
    )
    secret_enc = (
        crypto.encrypt(settings.rafine_master_key, body.oauth_client_secret)
        if body.oauth_client_secret
        else None
    )
    row = await db.pool().fetchrow(
        """
        INSERT INTO llm_providers
            (name, type, auth_mode, api_key_encrypted, oauth_client_id,
             oauth_client_secret_enc, oauth_auth_url, oauth_token_url,
             oauth_scopes, base_url, default_model, is_active,
             light_model, heavy_model, route_threshold_tokens)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
                COALESCE($15, 2000))
        RETURNING id::text AS id, name, type, auth_mode,
                  (api_key_encrypted IS NOT NULL) AS has_api_key,
                  base_url, default_model, is_active,
                  light_model, heavy_model, route_threshold_tokens
        """,
        body.name, body.type, body.auth_mode, api_key_enc, body.oauth_client_id,
        secret_enc, body.oauth_auth_url, body.oauth_token_url, body.oauth_scopes,
        body.base_url, body.default_model, body.is_active,
        body.light_model, body.heavy_model, body.route_threshold_tokens,
    )
    return ProviderOut(**dict(row))


@router.patch("/{provider_id}", response_model=ProviderOut)
async def update_provider(
    provider_id: str,
    body: ProviderUpdate,
    _: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    sets, args = [], []
    if body.name is not None:
        args.append(body.name); sets.append(f"name = ${len(args)}")
    if body.api_key is not None:
        args.append(crypto.encrypt(settings.rafine_master_key, body.api_key))
        sets.append(f"api_key_encrypted = ${len(args)}")
    if body.base_url is not None:
        args.append(body.base_url); sets.append(f"base_url = ${len(args)}")
    if body.default_model is not None:
        args.append(body.default_model); sets.append(f"default_model = ${len(args)}")
    if body.is_active is not None:
        args.append(body.is_active); sets.append(f"is_active = ${len(args)}")
    if body.light_model is not None:
        args.append(body.light_model); sets.append(f"light_model = ${len(args)}")
    if body.heavy_model is not None:
        args.append(body.heavy_model); sets.append(f"heavy_model = ${len(args)}")
    if body.route_threshold_tokens is not None:
        args.append(body.route_threshold_tokens)
        sets.append(f"route_threshold_tokens = ${len(args)}")
    if not sets:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no fields to update")

    args.append(provider_id)
    row = await db.pool().fetchrow(
        f"UPDATE llm_providers SET {', '.join(sets)}, updated_at = now() "
        f"WHERE id = ${len(args)} "
        f"RETURNING id::text AS id, name, type, auth_mode, "
        f"(api_key_encrypted IS NOT NULL) AS has_api_key, base_url, default_model, is_active, "
        f"light_model, heavy_model, route_threshold_tokens",
        *args,
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "provider not found")
    return ProviderOut(**dict(row))


@router.delete("/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_provider(provider_id: str, _: CurrentUser = Depends(require_admin)):
    result = await db.pool().execute(
        "DELETE FROM llm_providers WHERE id = $1", provider_id
    )
    if result.endswith("0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "provider not found")
