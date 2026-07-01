"""Team management (admin only).

Teams carry their own LLM usage limits and provider permissions. The gateway
loads team limits into RAM and applies them when a user has no personal
override. Provider access is enforced at conversation-creation time here in the
API (the gateway key is minted server-side, so users cannot bypass it).
"""
from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status

from .. import db
from ..deps import CurrentUser, require_admin
from ..schemas import TeamCreate, TeamMemberAdd, TeamMemberOut, TeamOut, TeamUpdate

router = APIRouter(prefix="/api/teams", tags=["teams"])


async def _provider_ids(team_id: str) -> list[str]:
    rows = await db.pool().fetch(
        "SELECT provider_id::text AS pid FROM team_provider_access WHERE team_id = $1",
        team_id,
    )
    return [r["pid"] for r in rows]


async def _team_out(team_id: str) -> TeamOut:
    row = await db.pool().fetchrow(
        """
        SELECT t.id::text AS id, t.name, t.description, t.rate_limit_rpm,
               t.daily_token_quota, t.created_at::text AS created_at,
               (SELECT count(*) FROM team_members m WHERE m.team_id = t.id) AS member_count
        FROM teams t WHERE t.id = $1
        """,
        team_id,
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "team not found")
    return TeamOut(**dict(row), provider_ids=await _provider_ids(team_id))


async def _set_provider_access(team_id: str, provider_ids: list[str]) -> None:
    await db.pool().execute("DELETE FROM team_provider_access WHERE team_id = $1", team_id)
    for pid in provider_ids:
        await db.pool().execute(
            "INSERT INTO team_provider_access (team_id, provider_id) VALUES ($1, $2) "
            "ON CONFLICT DO NOTHING",
            team_id, pid,
        )


@router.get("", response_model=list[TeamOut])
async def list_teams(_: CurrentUser = Depends(require_admin)):
    rows = await db.pool().fetch("SELECT id::text AS id FROM teams ORDER BY created_at")
    return [await _team_out(r["id"]) for r in rows]


@router.post("", response_model=TeamOut, status_code=status.HTTP_201_CREATED)
async def create_team(body: TeamCreate, _: CurrentUser = Depends(require_admin)):
    try:
        row = await db.pool().fetchrow(
            """
            INSERT INTO teams (name, description, rate_limit_rpm, daily_token_quota)
            VALUES ($1, $2, $3, $4) RETURNING id::text AS id
            """,
            body.name, body.description, body.rate_limit_rpm, body.daily_token_quota,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status.HTTP_409_CONFLICT, "bu isimde bir takım zaten var")
    await _set_provider_access(row["id"], body.provider_ids)
    return await _team_out(row["id"])


@router.patch("/{team_id}", response_model=TeamOut)
async def update_team(team_id: str, body: TeamUpdate, _: CurrentUser = Depends(require_admin)):
    sets, args = [], []
    if body.name is not None:
        args.append(body.name); sets.append(f"name = ${len(args)}")
    if body.description is not None:
        args.append(body.description); sets.append(f"description = ${len(args)}")
    if body.rate_limit_rpm is not None:
        args.append(body.rate_limit_rpm); sets.append(f"rate_limit_rpm = ${len(args)}")
    if body.daily_token_quota is not None:
        args.append(body.daily_token_quota); sets.append(f"daily_token_quota = ${len(args)}")
    if sets:
        args.append(team_id)
        res = await db.pool().execute(
            f"UPDATE teams SET {', '.join(sets)} WHERE id = ${len(args)}", *args
        )
        if res.endswith("0"):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "team not found")
    if body.provider_ids is not None:
        await _set_provider_access(team_id, body.provider_ids)
    return await _team_out(team_id)


@router.delete("/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_team(team_id: str, _: CurrentUser = Depends(require_admin)):
    res = await db.pool().execute("DELETE FROM teams WHERE id = $1", team_id)
    if res.endswith("0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "team not found")


@router.get("/{team_id}/members", response_model=list[TeamMemberOut])
async def list_members(team_id: str, _: CurrentUser = Depends(require_admin)):
    rows = await db.pool().fetch(
        """
        SELECT m.user_id::text AS user_id, u.email, m.role_in_team
        FROM team_members m JOIN users u ON u.id = m.user_id
        WHERE m.team_id = $1 ORDER BY u.email
        """,
        team_id,
    )
    return [TeamMemberOut(**dict(r)) for r in rows]


@router.post("/{team_id}/members", status_code=status.HTTP_204_NO_CONTENT)
async def add_member(team_id: str, body: TeamMemberAdd, _: CurrentUser = Depends(require_admin)):
    try:
        await db.pool().execute(
            "INSERT INTO team_members (team_id, user_id, role_in_team) VALUES ($1, $2, $3) "
            "ON CONFLICT (team_id, user_id) DO UPDATE SET role_in_team = $3",
            team_id, body.user_id, body.role_in_team,
        )
    except asyncpg.ForeignKeyViolationError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "geçersiz takım veya kullanıcı")


@router.delete("/{team_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(team_id: str, user_id: str, _: CurrentUser = Depends(require_admin)):
    await db.pool().execute(
        "DELETE FROM team_members WHERE team_id = $1 AND user_id = $2", team_id, user_id
    )
