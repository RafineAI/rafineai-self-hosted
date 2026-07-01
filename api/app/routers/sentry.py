"""Sentry integration: list projects and issues using the stored token."""
from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..deps import CurrentUser, get_current_user
from ..integrations import get_config

router = APIRouter(prefix="/api/tools/sentry", tags=["sentry"])


async def _get(path: str, params: dict | None = None):
    cfg = await get_config("sentry")
    token = cfg.get("token")
    org = cfg.get("org_slug")
    if not token or not org:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Sentry token/organizasyon yapılandırılmamış")
    base = (cfg.get("api_base") or "https://sentry.io").rstrip("/")
    async with httpx.AsyncClient(timeout=30, headers={"Authorization": f"Bearer {token}"}) as client:
        try:
            resp = await client.get(f"{base}{path}", params=params)
        except httpx.HTTPError as exc:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Sentry'e ulaşılamadı: {exc}")
    if resp.status_code >= 400:
        raise HTTPException(resp.status_code, f"Sentry hatası: {resp.text[:300]}")
    return resp.json(), org


@router.get("/projects")
async def list_projects(_: CurrentUser = Depends(get_current_user)):
    data, org = await _get(f"/api/0/organizations/{(await get_config('sentry')).get('org_slug')}/projects/")
    return [{"slug": p["slug"], "name": p["name"]} for p in data]


@router.get("/issues")
async def list_issues(
    project: str = Query(...),
    _: CurrentUser = Depends(get_current_user),
):
    cfg = await get_config("sentry")
    org = cfg.get("org_slug")
    data, _org = await _get(
        f"/api/0/projects/{org}/{project}/issues/",
        params={"query": "is:unresolved", "limit": 50},
    )
    return [
        {
            "id": i["id"],
            "title": i.get("title", ""),
            "culprit": i.get("culprit", ""),
            "level": i.get("level", ""),
            "count": i.get("count", "0"),
            "last_seen": i.get("lastSeen", ""),
            "permalink": i.get("permalink", ""),
        }
        for i in data
    ]
