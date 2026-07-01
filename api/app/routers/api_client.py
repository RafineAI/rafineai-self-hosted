"""API Client tool (Postman-like): send arbitrary HTTP requests, save them,
and ask the LLM to explain a request/response.

Outbound requests are guarded against SSRF: hostnames resolving to loopback,
private, or link-local addresses (incl. cloud metadata 169.254.169.254) are
rejected so the tool can't be used to reach internal infrastructure.
"""
from __future__ import annotations

import ipaddress
import socket
import time
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, status

from .. import db, llm
from ..config import Settings, get_settings
from ..deps import CurrentUser, get_current_user

router = APIRouter(prefix="/api/tools/api-client", tags=["api-client"])

_ALLOWED_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}
_MAX_RESPONSE_BYTES = 1024 * 1024


def _guard_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "yalnızca http/https desteklenir")
    host = parsed.hostname
    if not host:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "geçersiz URL")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "host çözümlenemedi")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_reserved:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "iç ağ / özel IP adreslerine istek engellendi (SSRF koruması)",
            )


@router.post("/send")
async def send_request(body: dict, _: CurrentUser = Depends(get_current_user)):
    method = str(body.get("method", "GET")).upper()
    url = str(body.get("url", "")).strip()
    headers = body.get("headers") or {}
    payload = body.get("body")
    if method not in _ALLOWED_METHODS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "geçersiz HTTP metodu")
    if not url:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "URL gerekli")
    _guard_url(url)

    start = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
            resp = await client.request(
                method, url,
                headers={str(k): str(v) for k, v in headers.items()},
                content=payload if isinstance(payload, str) and payload else None,
            )
            raw = resp.content[:_MAX_RESPONSE_BYTES]
    except httpx.HTTPError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"istek başarısız: {exc}")
    elapsed = int((time.monotonic() - start) * 1000)

    return {
        "status": resp.status_code,
        "headers": dict(resp.headers),
        "body": raw.decode("utf-8", errors="replace"),
        "time_ms": elapsed,
        "size_bytes": len(resp.content),
    }


@router.get("/requests")
async def list_saved(user: CurrentUser = Depends(get_current_user)):
    rows = await db.pool().fetch(
        "SELECT id::text AS id, name, method, url, headers, body, created_at::text AS created_at "
        "FROM api_requests WHERE owner_id = $1 ORDER BY created_at DESC",
        user.id,
    )
    return [dict(r) for r in rows]


@router.post("/requests", status_code=status.HTTP_201_CREATED)
async def save_request(body: dict, user: CurrentUser = Depends(get_current_user)):
    import json as _json
    row = await db.pool().fetchrow(
        """
        INSERT INTO api_requests (owner_id, name, method, url, headers, body)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
        RETURNING id::text AS id
        """,
        user.id,
        body.get("name", "İsimsiz istek"),
        str(body.get("method", "GET")).upper(),
        body.get("url", ""),
        _json.dumps(body.get("headers") or {}),
        body.get("body", ""),
    )
    return {"id": row["id"]}


@router.delete("/requests/{req_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_saved(req_id: str, user: CurrentUser = Depends(get_current_user)):
    await db.pool().execute(
        "DELETE FROM api_requests WHERE id = $1 AND owner_id = $2", req_id, user.id
    )


@router.post("/explain")
async def explain(
    body: dict,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    """Ask the LLM to explain a request/response (e.g. why it failed)."""
    req = body.get("request", {})
    resp = body.get("response", {})
    prompt = (
        "Aşağıdaki HTTP isteğini ve yanıtını bir yazılımcıya açıklar gibi Türkçe analiz et. "
        "Hata varsa olası nedenini ve nasıl düzeltileceğini madde madde belirt.\n\n"
        f"İSTEK:\n{req.get('method', '')} {req.get('url', '')}\n"
        f"Başlıklar: {req.get('headers', {})}\n"
        f"Gövde: {req.get('body', '')}\n\n"
        f"YANIT:\nHTTP {resp.get('status', '')}\n"
        f"Gövde: {str(resp.get('body', ''))[:4000]}\n"
    )
    return {"explanation": await llm.quick_complete(user, prompt, settings)}
