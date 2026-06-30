"""Usage metrics aggregated from audit_logs (admin only).

Cost is estimated from a static per-model price table (USD per 1K tokens);
unknown models contribute 0 so totals stay honest. All endpoints accept a
`days` window (default 30).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from .. import db
from ..deps import CurrentUser, require_admin

router = APIRouter(prefix="/api/metrics", tags=["metrics"])

# Rough public list prices (USD per 1K tokens), input+output blended.
# Estimation only — adjust per your contract. Unknown models => 0.
_PRICE_PER_1K = {
    "gpt-4o": 0.0075, "gpt-4o-mini": 0.0004, "gpt-4-turbo": 0.02,
    "claude-opus-4-8": 0.03, "claude-haiku-4-5-20251001": 0.002,
    "gemini-1.5-pro": 0.0035, "gemini-1.5-flash": 0.0004,
}


def _estimate_cost(model: str | None, tokens: int) -> float:
    price = _PRICE_PER_1K.get(model or "", 0.0)
    return round(tokens / 1000 * price, 6)


@router.get("/summary")
async def summary(
    _: CurrentUser = Depends(require_admin),
    days: int = Query(default=30, ge=1, le=365),
):
    row = await db.pool().fetchrow(
        f"""
        SELECT
            count(*)                                            AS requests,
            COALESCE(sum(request_tokens + response_tokens), 0)  AS tokens,
            COALESCE(avg(latency_ms), 0)::int                   AS avg_latency_ms,
            COALESCE(
                percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0
            )::int                                              AS p95_latency_ms,
            count(*) FILTER (WHERE status_code >= 400)          AS errors
        FROM audit_logs
        WHERE created_at >= now() - ($1 || ' days')::interval
        """,
        str(days),
    )
    # Cost needs per-model breakdown to apply the price table.
    model_rows = await db.pool().fetch(
        f"""
        SELECT model, COALESCE(sum(request_tokens + response_tokens), 0) AS tokens
        FROM audit_logs
        WHERE created_at >= now() - ($1 || ' days')::interval
        GROUP BY model
        """,
        str(days),
    )
    cost = sum(_estimate_cost(r["model"], r["tokens"]) for r in model_rows)
    requests = row["requests"] or 0
    errors = row["errors"] or 0
    return {
        "requests": requests,
        "tokens": int(row["tokens"]),
        "avg_latency_ms": row["avg_latency_ms"],
        "p95_latency_ms": row["p95_latency_ms"],
        "errors": errors,
        "error_rate": round(errors / requests, 4) if requests else 0.0,
        "estimated_cost_usd": round(cost, 4),
    }


@router.get("/timeseries")
async def timeseries(
    _: CurrentUser = Depends(require_admin),
    days: int = Query(default=30, ge=1, le=365),
):
    rows = await db.pool().fetch(
        f"""
        SELECT date_trunc('day', created_at)::date::text AS day,
               count(*)                                  AS requests,
               COALESCE(sum(request_tokens + response_tokens), 0) AS tokens
        FROM audit_logs
        WHERE created_at >= now() - ($1 || ' days')::interval
        GROUP BY day ORDER BY day
        """,
        str(days),
    )
    return [
        {"day": r["day"], "requests": r["requests"], "tokens": int(r["tokens"])}
        for r in rows
    ]


@router.get("/by_model")
async def by_model(
    _: CurrentUser = Depends(require_admin),
    days: int = Query(default=30, ge=1, le=365),
):
    rows = await db.pool().fetch(
        f"""
        SELECT COALESCE(model, 'bilinmiyor') AS model,
               count(*) AS requests,
               COALESCE(sum(request_tokens + response_tokens), 0) AS tokens
        FROM audit_logs
        WHERE created_at >= now() - ($1 || ' days')::interval
        GROUP BY model ORDER BY requests DESC
        """,
        str(days),
    )
    return [
        {
            "model": r["model"],
            "requests": r["requests"],
            "tokens": int(r["tokens"]),
            "estimated_cost_usd": _estimate_cost(r["model"], r["tokens"]),
        }
        for r in rows
    ]


@router.get("/by_user")
async def by_user(
    _: CurrentUser = Depends(require_admin),
    days: int = Query(default=30, ge=1, le=365),
    limit: int = Query(default=10, ge=1, le=100),
):
    rows = await db.pool().fetch(
        f"""
        SELECT COALESCE(u.email, 'bilinmiyor') AS email,
               count(*) AS requests,
               COALESCE(sum(a.request_tokens + a.response_tokens), 0) AS tokens
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.user_id
        WHERE a.created_at >= now() - ($1 || ' days')::interval
        GROUP BY u.email ORDER BY tokens DESC
        LIMIT $2
        """,
        str(days), limit,
    )
    return [
        {"email": r["email"], "requests": r["requests"], "tokens": int(r["tokens"])}
        for r in rows
    ]
