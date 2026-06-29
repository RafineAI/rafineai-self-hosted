"""Per-user OAuth2 connection flow for providers in 'oauth2' auth mode.

A generic authorization-code flow: /start returns the provider's consent URL
(with a signed `state`), and /callback exchanges the code for tokens and stores
them encrypted in user_provider_tokens.
"""
from __future__ import annotations

import datetime as dt
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse

from .. import crypto, db, security
from ..config import Settings, get_settings
from ..deps import CurrentUser, get_current_user

router = APIRouter(prefix="/api", tags=["oauth"])


def _state_token(secret: str, user_id: str, provider_id: str) -> str:
    payload = {
        "sub": user_id,
        "pid": provider_id,
        "type": "oauth_state",
        "exp": dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=15),
    }
    return jwt.encode(payload, secret, algorithm=security.ALGO)


@router.get("/providers/{provider_id}/oauth/start")
async def oauth_start(
    provider_id: str,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    row = await db.pool().fetchrow(
        "SELECT auth_mode, oauth_client_id, oauth_auth_url, oauth_scopes "
        "FROM llm_providers WHERE id = $1",
        provider_id,
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "provider not found")
    if row["auth_mode"] != "oauth2":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "provider is not oauth2")
    if not row["oauth_auth_url"] or not row["oauth_client_id"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "provider oauth not configured")

    state = _state_token(settings.jwt_secret, user.id, provider_id)
    redirect_uri = f"{settings.rafine_public_url}/api/oauth/callback"
    params = {
        "response_type": "code",
        "client_id": row["oauth_client_id"],
        "redirect_uri": redirect_uri,
        "state": state,
    }
    if row["oauth_scopes"]:
        params["scope"] = row["oauth_scopes"]
    return {"auth_url": f"{row['oauth_auth_url']}?{urlencode(params)}"}


@router.get("/oauth/callback")
async def oauth_callback(
    code: str,
    state: str,
    settings: Settings = Depends(get_settings),
):
    try:
        claims = security.decode_token(settings.jwt_secret, state)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid state")
    if claims.get("type") != "oauth_state":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "bad state type")
    user_id, provider_id = claims["sub"], claims["pid"]

    row = await db.pool().fetchrow(
        "SELECT oauth_client_id, oauth_client_secret_enc, oauth_token_url "
        "FROM llm_providers WHERE id = $1",
        provider_id,
    )
    if not row or not row["oauth_token_url"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "provider token url missing")

    client_secret = ""
    if row["oauth_client_secret_enc"]:
        client_secret = crypto.decrypt(
            settings.rafine_master_key, row["oauth_client_secret_enc"]
        )

    redirect_uri = f"{settings.rafine_public_url}/api/oauth/callback"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            row["oauth_token_url"],
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": row["oauth_client_id"],
                "client_secret": client_secret,
            },
            headers={"Accept": "application/json"},
        )
    if resp.status_code >= 400:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"token exchange failed: {resp.text}")
    tokens = resp.json()
    access = tokens.get("access_token")
    if not access:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "no access_token in response")
    refresh = tokens.get("refresh_token")
    expires_in = tokens.get("expires_in")
    expires_at = (
        dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=int(expires_in))
        if expires_in
        else None
    )

    await db.pool().execute(
        """
        INSERT INTO user_provider_tokens
            (user_id, provider_id, access_token_encrypted, refresh_token_encrypted, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, provider_id) DO UPDATE
            SET access_token_encrypted = EXCLUDED.access_token_encrypted,
                refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
                expires_at = EXCLUDED.expires_at,
                updated_at = now()
        """,
        user_id,
        provider_id,
        crypto.encrypt(settings.rafine_master_key, access),
        crypto.encrypt(settings.rafine_master_key, refresh) if refresh else None,
        expires_at,
    )
    # Send the user back to the panel.
    return RedirectResponse(url=f"{settings.rafine_public_url}/providers?connected=1")
