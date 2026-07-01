"""Sentry integration: list projects and issues using the stored token.

Also exposes `POST /explain`: paste a Sentry issue link and the latest event's
exception + stacktrace are pulled and handed to the LLM (through the gateway,
so the content policy still applies) for a root-cause explanation and a
proposed fix — all shown in the panel.
"""
from __future__ import annotations

import re

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from .. import llm
from ..config import Settings, get_settings
from ..deps import CurrentUser, get_current_user
from ..integrations import get_config

router = APIRouter(prefix="/api/tools/sentry", tags=["sentry"])

# Sentry issue links look like:
#   https://<org>.sentry.io/issues/<id>/
#   https://sentry.io/organizations/<org>/issues/<id>/
#   https://<self-hosted-host>/organizations/<org>/issues/<id>/
_ISSUE_ID_RE = re.compile(r"/issues/(\d+)")


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


class ExplainRequest(BaseModel):
    # Either a full Sentry issue URL or a bare numeric issue id.
    issue: str


def _stacktrace_text(event: dict) -> str:
    """Extract a compact 'Type: value' + top stack frames from a Sentry event."""
    lines: list[str] = []
    for entry in event.get("entries", []):
        if entry.get("type") != "exception":
            continue
        for val in entry.get("data", {}).get("values", []):
            lines.append(f"{val.get('type', 'Error')}: {val.get('value', '')}")
            frames = (val.get("stacktrace") or {}).get("frames", []) or []
            # Sentry lists frames oldest-first; the crash is the last few.
            for f in frames[-15:]:
                loc = f.get("filename") or f.get("module") or "?"
                fn = f.get("function") or "?"
                lineno = f.get("lineNo")
                at = f":{lineno}" if lineno else ""
                ctx = (f.get("context") or [])
                crash_line = next((c[1] for c in ctx if len(c) > 1 and c[0] == f.get("lineNo")), "")
                lines.append(f"  at {fn} ({loc}{at}){(' — ' + crash_line.strip()) if crash_line else ''}")
    return "\n".join(lines)


@router.post("/explain")
async def explain_issue(
    body: ExplainRequest,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    """Fetch an issue's latest event and ask the LLM to explain + propose a fix."""
    raw = body.issue.strip()
    m = _ISSUE_ID_RE.search(raw)
    issue_id = m.group(1) if m else (raw if raw.isdigit() else "")
    if not issue_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Geçerli bir Sentry issue linki veya id'si girin.",
        )

    cfg = await get_config("sentry")
    org = cfg.get("org_slug")
    issue, _ = await _get(f"/api/0/organizations/{org}/issues/{issue_id}/")
    event, _ = await _get(f"/api/0/organizations/{org}/issues/{issue_id}/events/latest/")

    context = (
        f"Başlık: {issue.get('title', '')}\n"
        f"Culprit: {issue.get('culprit', '')}\n"
        f"Seviye: {issue.get('level', '')}\n"
        f"Görülme sayısı: {issue.get('count', '')}\n"
        f"Platform: {event.get('platform', '')}\n\n"
        f"Exception / stacktrace:\n{_stacktrace_text(event) or 'Stacktrace bulunamadı.'}"
    )
    prompt = (
        "Aşağıdaki Sentry hatasını bir kıdemli yazılımcı gibi analiz et. "
        "Önce hatanın kök nedenini kısaca açıkla, ardından somut ve uygulanabilir "
        "bir çözüm öner (gerekiyorsa kod örneğiyle). Türkçe ve öz yanıtla.\n\n"
        f"{context}"
    )
    answer = await llm.quick_complete(user, prompt, settings)
    return {
        "issue_id": issue_id,
        "title": issue.get("title", ""),
        "permalink": issue.get("permalink", ""),
        "answer": answer,
    }
