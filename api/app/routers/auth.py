"""Authentication endpoints: login, refresh, me."""
from __future__ import annotations

import jwt
from fastapi import APIRouter, Depends, HTTPException, status

from .. import db, security
from ..config import Settings, get_settings
from ..deps import CurrentUser, get_current_user
from ..schemas import (
    ChangePasswordRequest,
    LoginRequest,
    RefreshRequest,
    TokenResponse,
    UserOut,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, settings: Settings = Depends(get_settings)):
    row = await db.pool().fetchrow(
        "SELECT id::text AS id, password_hash, role, is_active FROM users WHERE email = $1",
        body.email,
    )
    if not row or not row["is_active"] or not security.verify_password(
        body.password, row["password_hash"]
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")

    return TokenResponse(
        access_token=security.create_access_token(
            settings.jwt_secret, row["id"], row["role"], settings.jwt_access_ttl_min
        ),
        refresh_token=security.create_refresh_token(
            settings.jwt_secret, row["id"], settings.jwt_refresh_ttl_days
        ),
        role=row["role"],
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, settings: Settings = Depends(get_settings)):
    try:
        claims = security.decode_token(settings.jwt_secret, body.refresh_token)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid refresh token")
    if claims.get("type") != "refresh":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "wrong token type")

    row = await db.pool().fetchrow(
        "SELECT id::text AS id, role, is_active FROM users WHERE id = $1", claims["sub"]
    )
    if not row or not row["is_active"]:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "user inactive")

    return TokenResponse(
        access_token=security.create_access_token(
            settings.jwt_secret, row["id"], row["role"], settings.jwt_access_ttl_min
        ),
        refresh_token=security.create_refresh_token(
            settings.jwt_secret, row["id"], settings.jwt_refresh_ttl_days
        ),
        role=row["role"],
    )


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser = Depends(get_current_user)):
    row = await db.pool().fetchrow(
        "SELECT id::text AS id, email, role, is_active, must_change_password "
        "FROM users WHERE id = $1",
        user.id,
    )
    return UserOut(**dict(row))


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: ChangePasswordRequest,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    row = await db.pool().fetchrow(
        "SELECT password_hash FROM users WHERE id = $1", user.id
    )
    if not row or not security.verify_password(body.current_password, row["password_hash"]):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "current password is incorrect")
    await db.pool().execute(
        "UPDATE users SET password_hash = $1, must_change_password = FALSE, "
        "updated_at = now() WHERE id = $2",
        security.hash_password(body.new_password),
        user.id,
    )
