"""App-wide settings (theme, branding, chat UI). Read is public; write is admin-only."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from .. import db
from ..deps import CurrentUser, require_admin

router = APIRouter(prefix="/api/settings", tags=["settings"])

ALLOWED_THEMES = {"default", "ocean", "forest", "sunset", "rose"}

# Every key the admin may set. Values are plain text (no injection risk since
# they are only rendered in the UI, never executed).
ALLOWED_KEYS = {
    "chat_theme",
    "app_name",
    "app_logo",
    "app_logo_url",
    "app_tagline",
    "chat_welcome_title",
    "chat_welcome_subtitle",
    "chat_placeholder",
    "chat_send_label",
}

MAX_LEN = {
    "app_logo": 4,           # emoji or 1-2 chars
    "app_logo_url": 512,
    "app_name": 64,
    "app_tagline": 128,
    "chat_welcome_title": 128,
    "chat_welcome_subtitle": 256,
    "chat_placeholder": 256,
    "chat_send_label": 32,
}


@router.get("")
async def get_settings():
    rows = await db.pool().fetch("SELECT key, value FROM app_settings")
    return {r["key"]: r["value"] for r in rows}


@router.put("")
async def update_settings(
    body: dict,
    _: CurrentUser = Depends(require_admin),
):
    for key, value in body.items():
        if key not in ALLOWED_KEYS:
            continue
        if not isinstance(value, str):
            continue
        if key == "chat_theme" and value not in ALLOWED_THEMES:
            continue
        if key in MAX_LEN and len(value) > MAX_LEN[key]:
            continue
        await db.pool().execute(
            """
            INSERT INTO app_settings (key, value, updated_at)
            VALUES ($1, $2, now())
            ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()
            """,
            key, value,
        )
    return await get_settings()
