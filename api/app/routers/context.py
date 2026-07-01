"""Chat context attach: pull text from an installed integration into a chat.

A normal user can attach context from an installed+enabled marketplace tool
(Sentry issue, GitHub file, Slack channel) to their next chat message. The
fetched text is injected into the message as a <document> block on the client,
so the LLM (and the gateway's content policy) see it like any other context.

Each source reuses its own router's fetch helper; unknown/uninstalled sources
surface the same friendly "install it first" error as the tool pages.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..deps import CurrentUser, get_current_user
from . import github, sentry, slack

router = APIRouter(prefix="/api/tools", tags=["context"])


class ContextRequest(BaseModel):
    source: str   # 'sentry' | 'github' | 'slack'
    ref: str      # issue link/id, github file link/path, or slack channel


@router.post("/context")
async def fetch_context(body: ContextRequest, _: CurrentUser = Depends(get_current_user)):
    ref = body.ref.strip()
    if not ref:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "bir referans girin")
    if body.source == "sentry":
        label, text = await sentry.issue_context(ref)
    elif body.source == "github":
        label, text = await github.file_context(ref)
    elif body.source == "slack":
        label, text = await slack.channel_context(ref)
    else:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "bilinmeyen kaynak")
    return {"label": label, "text": text}
