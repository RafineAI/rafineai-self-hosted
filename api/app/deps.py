"""FastAPI dependencies: current-user resolution and role guards."""
from __future__ import annotations

from dataclasses import dataclass

import jwt
from fastapi import Depends, Header, HTTPException, status

from . import db, security
from .config import Settings, get_settings


@dataclass
class CurrentUser:
    id: str
    role: str


async def get_current_user(
    authorization: str = Header(default=""),
    settings: Settings = Depends(get_settings),
) -> CurrentUser:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing bearer token")
    token = authorization[len("Bearer "):]
    try:
        claims = security.decode_token(settings.jwt_secret, token)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token")
    if claims.get("type") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "wrong token type")

    row = await db.pool().fetchrow(
        "SELECT id::text AS id, role, is_active FROM users WHERE id = $1", claims["sub"]
    )
    if not row or not row["is_active"]:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "user inactive or missing")
    return CurrentUser(id=row["id"], role=row["role"])


def require_roles(*roles: str):
    """Dependency factory enforcing that the user holds one of the roles."""
    async def _guard(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient privileges")
        return user

    return _guard


# Common guards.
require_admin = require_roles("owner", "admin")
