"""GitHub integration: list repos, browse the tree, read file contents.

Uses the token stored by the marketplace 'github' integration. All calls are
server-side proxies so the token never reaches the browser.
"""
from __future__ import annotations

import base64

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..deps import CurrentUser, get_current_user
from ..integrations import get_config

router = APIRouter(prefix="/api/tools/github", tags=["github"])

_MAX_FILE_BYTES = 512 * 1024


async def _client() -> tuple[httpx.AsyncClient, str]:
    cfg = await get_config("github")
    token = cfg.get("token")
    if not token:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "GitHub token yapılandırılmamış")
    base = (cfg.get("api_base") or "https://api.github.com").rstrip("/")
    client = httpx.AsyncClient(
        base_url=base,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
        timeout=30,
    )
    return client, base


async def _get(path: str, params: dict | None = None):
    client, _ = await _client()
    async with client:
        try:
            resp = await client.get(path, params=params)
        except httpx.HTTPError as exc:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"GitHub'a ulaşılamadı: {exc}")
    if resp.status_code >= 400:
        raise HTTPException(resp.status_code, f"GitHub hatası: {resp.text[:300]}")
    return resp.json()


@router.get("/repos")
async def list_repos(_: CurrentUser = Depends(get_current_user)):
    data = await _get("/user/repos", {"per_page": 100, "sort": "updated"})
    return [
        {
            "full_name": r["full_name"],
            "private": r["private"],
            "default_branch": r.get("default_branch", "main"),
            "description": r.get("description") or "",
        }
        for r in data
    ]


@router.get("/repos/{owner}/{repo}/tree")
async def list_tree(
    owner: str, repo: str,
    path: str = Query(default=""),
    _: CurrentUser = Depends(get_current_user),
):
    data = await _get(f"/repos/{owner}/{repo}/contents/{path}")
    if isinstance(data, dict):  # a file path was requested
        data = [data]
    return [
        {"name": e["name"], "path": e["path"], "type": e["type"], "size": e.get("size", 0)}
        for e in data
    ]


@router.get("/repos/{owner}/{repo}/file")
async def read_file(
    owner: str, repo: str,
    path: str = Query(...),
    _: CurrentUser = Depends(get_current_user),
):
    data = await _get(f"/repos/{owner}/{repo}/contents/{path}")
    if isinstance(data, list):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "bu bir klasör")
    if data.get("size", 0) > _MAX_FILE_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "dosya çok büyük")
    content = data.get("content", "")
    try:
        text = base64.b64decode(content).decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        text = "(ikili dosya — önizlenemiyor)"
    return {"path": data["path"], "size": data.get("size", 0), "content": text}
