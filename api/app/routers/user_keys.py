"""User-owned BYOK API keys.

Users can store their own provider API keys (Gemini, OpenAI, Anthropic).
The gateway loads these and uses them in preference to the shared provider key,
so users can chat even when the admin hasn't added a shared credential.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from .. import crypto, db
from ..config import Settings, get_settings
from ..deps import CurrentUser, get_current_user
from ..schemas import OwnKeyCreate, OwnKeyOut
from ..validate import validate_api_key

KNOWN_TYPES = {"openai", "anthropic", "gemini"}

router = APIRouter(prefix="/api/user/own-keys", tags=["user-own-keys"])


@router.get("", response_model=list[OwnKeyOut])
async def list_own_keys(user: CurrentUser = Depends(get_current_user)):
    rows = await db.pool().fetch(
        "SELECT provider_type, label, created_at::text FROM user_own_keys "
        "WHERE user_id = $1 ORDER BY provider_type",
        user.id,
    )
    return [OwnKeyOut(**dict(r)) for r in rows]


@router.put("/{provider_type}", status_code=status.HTTP_204_NO_CONTENT)
async def upsert_own_key(
    provider_type: str,
    body: OwnKeyCreate,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    if provider_type not in KNOWN_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Bilinmeyen provider tipi: {provider_type}")
    await validate_api_key(provider_type, body.api_key)
    enc = crypto.encrypt(settings.rafine_master_key, body.api_key)
    await db.pool().execute(
        """
        INSERT INTO user_own_keys (user_id, provider_type, encrypted_key, label)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (user_id, provider_type)
        DO UPDATE SET encrypted_key = $3, label = $4
        """,
        user.id, provider_type, enc, body.label,
    )


@router.delete("/{provider_type}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_own_key(
    provider_type: str,
    user: CurrentUser = Depends(get_current_user),
):
    if provider_type not in KNOWN_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Bilinmeyen provider tipi: {provider_type}")
    await db.pool().execute(
        "DELETE FROM user_own_keys WHERE user_id = $1 AND provider_type = $2",
        user.id, provider_type,
    )
