"""GitHub integration: list repos, browse the tree, read file contents.

Uses the token stored by the marketplace 'github' integration. All calls are
server-side proxies so the token never reaches the browser.
"""
from __future__ import annotations

import base64
import re

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..deps import CurrentUser, get_current_user
from ..integrations import get_config

router = APIRouter(prefix="/api/tools/github", tags=["github"])

_MAX_FILE_BYTES = 512 * 1024

# https://github.com/<owner>/<repo>/blob/<branch>/<path...>
_GH_BLOB_RE = re.compile(r"github\.com/([^/]+)/([^/]+)/blob/[^/]+/(.+)")


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


async def file_context(ref: str) -> tuple[str, str]:
    """(label, file-content) for the chat context-attach feature.

    Accepts a github.com blob URL or an `owner/repo/path` reference.
    """
    ref = ref.strip().split("?")[0].split("#")[0]
    m = _GH_BLOB_RE.search(ref)
    if m:
        owner, repo, path = m.group(1), m.group(2), m.group(3)
    else:
        parts = ref.lstrip("/").split("/", 2)
        if len(parts) < 3 or not all(parts):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "GitHub dosya linki ya da 'owner/repo/dosya/yolu' girin.",
            )
        owner, repo, path = parts
    data = await _get(f"/repos/{owner}/{repo}/contents/{path}")
    if isinstance(data, list):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "bu bir klasör, dosya girin")
    if data.get("size", 0) > _MAX_FILE_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "dosya çok büyük")
    try:
        text = base64.b64decode(data.get("content", "")).decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        text = "(ikili dosya — önizlenemiyor)"
    return f"GitHub: {owner}/{repo}/{path}", f"Dosya: {path}\n\n{text}"
