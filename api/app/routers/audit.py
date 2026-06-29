"""Audit log query API (admin only)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from .. import db
from ..deps import CurrentUser, require_admin

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("")
async def list_audit(
    _: CurrentUser = Depends(require_admin),
    user_id: str | None = None,
    provider_id: str | None = None,
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
):
    where, args = [], []
    if user_id:
        args.append(user_id); where.append(f"user_id = ${len(args)}")
    if provider_id:
        args.append(provider_id); where.append(f"provider_id = ${len(args)}")
    clause = ("WHERE " + " AND ".join(where)) if where else ""

    args.append(limit); limit_idx = len(args)
    args.append(offset); offset_idx = len(args)
    rows = await db.pool().fetch(
        f"""
        SELECT id::text AS id, user_id::text AS user_id, provider_id::text AS provider_id,
               conversation_id::text AS conversation_id, model,
               request_tokens, response_tokens, latency_ms, status_code,
               applied_policies, cost_usd, error, created_at
        FROM audit_logs {clause}
        ORDER BY created_at DESC
        LIMIT ${limit_idx} OFFSET ${offset_idx}
        """,
        *args,
    )
    return [dict(r) | {"created_at": r["created_at"].isoformat()} for r in rows]
