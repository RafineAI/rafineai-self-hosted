"""Admin content-policy management: custom rules and alerts."""
from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, status

from .. import db
from ..deps import CurrentUser, require_admin
from ..schemas import AlertOut, PolicyRuleCreate, PolicyRuleOut, PolicyRuleUpdate

router = APIRouter(prefix="/api/policy", tags=["policy"])

_RULE_COLS = "id::text AS id, name, category, kind, pattern, action, severity, enabled"

# The gateway's always-on detectors, surfaced read-only so admins can see what
# is protected out of the box (kept in sync with gateway/internal/policy).
BUILTINS = [
    {"name": "secret_openai_key", "category": "secret", "action": "mask", "severity": "high"},
    {"name": "secret_aws_key", "category": "secret", "action": "mask", "severity": "high"},
    {"name": "secret_bearer", "category": "secret", "action": "mask", "severity": "high"},
    {"name": "secret_private_key", "category": "secret", "action": "block", "severity": "high"},
    {"name": "tckn", "category": "customer_data", "action": "mask", "severity": "high"},
    {"name": "iban_tr", "category": "financial", "action": "mask", "severity": "high"},
    {"name": "credit_card", "category": "financial", "action": "mask", "severity": "high"},
    {"name": "phone_tr", "category": "customer_data", "action": "mask", "severity": "medium"},
    {"name": "email", "category": "customer_data", "action": "flag", "severity": "low"},
    {"name": "financial_lexicon_tr", "category": "financial", "action": "flag", "severity": "medium"},
    {"name": "customer_lexicon_tr", "category": "customer_data", "action": "flag", "severity": "low"},
]


@router.get("/builtins")
async def list_builtins(_: CurrentUser = Depends(require_admin)):
    return BUILTINS


@router.get("/rules", response_model=list[PolicyRuleOut])
async def list_rules(_: CurrentUser = Depends(require_admin)):
    rows = await db.pool().fetch(f"SELECT {_RULE_COLS} FROM policy_rules ORDER BY created_at")
    return [PolicyRuleOut(**dict(r)) for r in rows]


@router.post("/rules", response_model=PolicyRuleOut, status_code=status.HTTP_201_CREATED)
async def create_rule(body: PolicyRuleCreate, _: CurrentUser = Depends(require_admin)):
    try:
        row = await db.pool().fetchrow(
            f"""
            INSERT INTO policy_rules (name, category, kind, pattern, action, severity, enabled)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING {_RULE_COLS}
            """,
            body.name, body.category, body.kind, body.pattern,
            body.action, body.severity, body.enabled,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status.HTTP_409_CONFLICT, "rule name already exists")
    return PolicyRuleOut(**dict(row))


@router.patch("/rules/{rule_id}", response_model=PolicyRuleOut)
async def update_rule(rule_id: str, body: PolicyRuleUpdate, _: CurrentUser = Depends(require_admin)):
    sets, args = [], []
    for field in ("pattern", "action", "severity", "enabled"):
        val = getattr(body, field)
        if val is not None:
            args.append(val); sets.append(f"{field} = ${len(args)}")
    if not sets:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no fields to update")
    args.append(rule_id)
    row = await db.pool().fetchrow(
        f"UPDATE policy_rules SET {', '.join(sets)}, updated_at = now() "
        f"WHERE id = ${len(args)} RETURNING {_RULE_COLS}",
        *args,
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "rule not found")
    return PolicyRuleOut(**dict(row))


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(rule_id: str, _: CurrentUser = Depends(require_admin)):
    result = await db.pool().execute("DELETE FROM policy_rules WHERE id = $1", rule_id)
    if result.endswith("0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "rule not found")


# ---- Alerts ----
alerts_router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@alerts_router.get("", response_model=list[AlertOut])
async def list_alerts(
    _: CurrentUser = Depends(require_admin),
    resolved: bool | None = None,
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
):
    where, args = [], []
    if resolved is not None:
        args.append(resolved); where.append(f"resolved = ${len(args)}")
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    args.append(limit); args.append(offset)
    rows = await db.pool().fetch(
        f"""
        SELECT id::text AS id, user_id::text AS user_id,
               conversation_id::text AS conversation_id, rule_name, category,
               action, severity, snippet, resolved, created_at
        FROM alerts {clause}
        ORDER BY created_at DESC
        LIMIT ${len(args)-1} OFFSET ${len(args)}
        """,
        *args,
    )
    return [AlertOut(**(dict(r) | {"created_at": r["created_at"].isoformat()})) for r in rows]


@alerts_router.post("/{alert_id}/resolve", status_code=status.HTTP_204_NO_CONTENT)
async def resolve_alert(alert_id: str, _: CurrentUser = Depends(require_admin)):
    result = await db.pool().execute(
        "UPDATE alerts SET resolved = TRUE WHERE id = $1", alert_id
    )
    if result.endswith("0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "alert not found")
