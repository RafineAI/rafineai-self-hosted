"""User management (owner/admin only)."""
from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status

from .. import db, security
from ..deps import CurrentUser, require_admin
from ..schemas import UserCreate, UserOut, UserUpdate

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[UserOut])
async def list_users(_: CurrentUser = Depends(require_admin)):
    rows = await db.pool().fetch(
        "SELECT id::text AS id, email, role, is_active FROM users ORDER BY created_at"
    )
    return [UserOut(**dict(r)) for r in rows]


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(body: UserCreate, _: CurrentUser = Depends(require_admin)):
    try:
        row = await db.pool().fetchrow(
            """
            INSERT INTO users (email, password_hash, role)
            VALUES ($1, $2, $3)
            RETURNING id::text AS id, email, role, is_active
            """,
            body.email,
            security.hash_password(body.password),
            body.role,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status.HTTP_409_CONFLICT, "email already exists")
    return UserOut(**dict(row))


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: str, body: UserUpdate, _: CurrentUser = Depends(require_admin)
):
    target = await db.pool().fetchrow("SELECT role FROM users WHERE id = $1", user_id)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    if target["role"] == "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "the owner cannot be modified")

    sets, args = [], []
    if body.password is not None:
        args.append(security.hash_password(body.password))
        sets.append(f"password_hash = ${len(args)}")
    if body.role is not None:
        args.append(body.role)
        sets.append(f"role = ${len(args)}")
    if body.is_active is not None:
        args.append(body.is_active)
        sets.append(f"is_active = ${len(args)}")
    if not sets:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no fields to update")

    args.append(user_id)
    row = await db.pool().fetchrow(
        f"UPDATE users SET {', '.join(sets)}, updated_at = now() "
        f"WHERE id = ${len(args)} RETURNING id::text AS id, email, role, is_active",
        *args,
    )
    return UserOut(**dict(row))


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: str, actor: CurrentUser = Depends(require_admin)):
    target = await db.pool().fetchrow("SELECT role FROM users WHERE id = $1", user_id)
    if not target:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    if target["role"] == "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "the owner cannot be deleted")
    if user_id == actor.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot delete yourself")
    await db.pool().execute("DELETE FROM users WHERE id = $1", user_id)
