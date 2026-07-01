"""Marketplace: list catalog, install/configure, uninstall integrations.

Install/uninstall is admin-only. Secret config values are encrypted with the
master key and never returned; the client only learns whether a field is set.
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, status

from .. import crypto, db, marketplace
from ..config import Settings, get_settings
from ..deps import CurrentUser, get_current_user, require_admin

router = APIRouter(prefix="/api/marketplace", tags=["marketplace"])


async def _installed_map() -> dict[str, dict]:
    rows = await db.pool().fetch(
        "SELECT app_slug, enabled, config_encrypted FROM installed_integrations"
    )
    return {r["app_slug"]: dict(r) for r in rows}


@router.get("")
async def list_catalog(user: CurrentUser = Depends(get_current_user)):
    installed = await _installed_map()
    return [
        marketplace.public_app(
            app,
            installed=(app["slug"] in installed),
            enabled=bool(installed.get(app["slug"], {}).get("enabled", False)),
        )
        for app in marketplace.CATALOG
    ]


@router.get("/{slug}/config")
async def get_config_status(slug: str, _: CurrentUser = Depends(require_admin),
                            settings: Settings = Depends(get_settings)):
    """Return which config keys are set (values redacted)."""
    app = marketplace.BY_SLUG.get(slug)
    if not app:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "uygulama bulunamadı")
    row = await db.pool().fetchrow(
        "SELECT config_encrypted FROM installed_integrations WHERE app_slug = $1", slug
    )
    cfg: dict = {}
    if row and row["config_encrypted"]:
        try:
            cfg = json.loads(crypto.decrypt(settings.rafine_master_key, row["config_encrypted"]))
        except Exception:  # noqa: BLE001
            cfg = {}
    # Redact secrets; show non-secret values so the admin can review them.
    out = {}
    for f in app["config_fields"]:
        val = cfg.get(f["key"], "")
        if f.get("secret"):
            out[f["key"]] = "••••••" if val else ""
        else:
            out[f["key"]] = val
    return out


@router.post("/{slug}/install", status_code=status.HTTP_204_NO_CONTENT)
async def install(
    slug: str,
    body: dict,
    user: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    app = marketplace.BY_SLUG.get(slug)
    if not app:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "uygulama bulunamadı")

    # Merge with any existing config so unchanged secrets are preserved when the
    # client submits a redacted placeholder.
    existing = {}
    row = await db.pool().fetchrow(
        "SELECT config_encrypted FROM installed_integrations WHERE app_slug = $1", slug
    )
    if row and row["config_encrypted"]:
        try:
            existing = json.loads(crypto.decrypt(settings.rafine_master_key, row["config_encrypted"]))
        except Exception:  # noqa: BLE001
            existing = {}

    config = dict(existing)
    incoming = body.get("config", {}) if isinstance(body, dict) else {}
    for f in app["config_fields"]:
        key = f["key"]
        if key in incoming and incoming[key] not in ("", "••••••"):
            config[key] = incoming[key]

    # Validate required (non-optional) fields are present.
    missing = [
        f["label"] for f in app["config_fields"]
        if not f.get("optional") and not config.get(f["key"])
    ]
    if missing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"eksik alanlar: {', '.join(missing)}")

    blob = crypto.encrypt(settings.rafine_master_key, json.dumps(config)) if config else ""
    await db.pool().execute(
        """
        INSERT INTO installed_integrations (app_slug, config_encrypted, enabled, installed_by)
        VALUES ($1, $2, TRUE, $3)
        ON CONFLICT (app_slug)
        DO UPDATE SET config_encrypted = $2, enabled = TRUE, updated_at = now()
        """,
        slug, blob, user.id,
    )


@router.post("/{slug}/toggle", status_code=status.HTTP_204_NO_CONTENT)
async def toggle(slug: str, body: dict, _: CurrentUser = Depends(require_admin)):
    enabled = bool(body.get("enabled", True))
    res = await db.pool().execute(
        "UPDATE installed_integrations SET enabled = $2, updated_at = now() WHERE app_slug = $1",
        slug, enabled,
    )
    if res.endswith("0"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "entegrasyon kurulu değil")


@router.delete("/{slug}", status_code=status.HTTP_204_NO_CONTENT)
async def uninstall(slug: str, _: CurrentUser = Depends(require_admin)):
    await db.pool().execute("DELETE FROM installed_integrations WHERE app_slug = $1", slug)
