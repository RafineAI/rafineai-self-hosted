"""Governed web-read: fetch a public URL and return readable text for chat context.

This is the "read a web page" capability the stack previously lacked entirely.
It reuses the manual context-attach flow (like GitHub/Sentry/Slack): the user
supplies a URL, we fetch it server-side, strip HTML to text, and hand back a
`(label, text)` pair that the panel injects as a <document> block — so the
gateway's content policy still sees it like any other context.

Outbound fetches are SSRF-guarded (app.netguard) and size/redirect-capped.
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException, status

from ..netguard import guard_url

_MAX_BYTES = 512 * 1024
_MAX_TEXT = 40_000
_UA = "RafineAI/1.0 (+governed web-read)"

_DROP = re.compile(r"(?is)<(script|style|noscript|template|svg)[^>]*>.*?</\1>")
_TAGS = re.compile(r"(?s)<[^>]+>")
_ENTITIES = (("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&#39;", "'"), ("&nbsp;", " "))
_INLINE_WS = re.compile(r"[ \t\r\f\v]+")
_BLANK_LINES = re.compile(r"\n\s*\n\s*")


def _html_to_text(html: str) -> str:
    txt = _DROP.sub(" ", html)
    txt = _TAGS.sub(" ", txt)
    for a, b in _ENTITIES:
        txt = txt.replace(a, b)
    txt = _INLINE_WS.sub(" ", txt)
    txt = _BLANK_LINES.sub("\n\n", txt)
    return txt.strip()


async def page_context(ref: str) -> tuple[str, str]:
    """(label, page-text) for the chat context-attach feature."""
    url = ref.strip()
    if not urlparse(url).scheme:
        url = "https://" + url
    guard_url(url)  # SSRF guard — must run before any network call
    try:
        async with httpx.AsyncClient(
            timeout=20, follow_redirects=False, headers={"User-Agent": _UA}
        ) as client:
            resp = await client.get(url)
    except httpx.HTTPError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"sayfa alınamadı: {exc}")

    if 300 <= resp.status_code < 400:
        loc = resp.headers.get("location", "")
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"URL yönlendiriyor → {loc or '(bilinmiyor)'} — nihai adresi girin",
        )
    if resp.status_code >= 400:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"sayfa hatası: HTTP {resp.status_code}")

    raw = resp.content[:_MAX_BYTES]
    body = raw.decode(resp.encoding or "utf-8", errors="replace")
    ctype = resp.headers.get("content-type", "").lower()
    is_html = "html" in ctype or "<html" in body[:2048].lower()
    text = _html_to_text(body) if is_html else body.strip()
    if not text:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "sayfadan metin çıkarılamadı")
    if len(text) > _MAX_TEXT:
        text = text[:_MAX_TEXT] + "\n\n… (kısaltıldı)"

    host = urlparse(url).hostname or url
    return f"Web: {host}", f"Kaynak: {url}\n\n{text}"
