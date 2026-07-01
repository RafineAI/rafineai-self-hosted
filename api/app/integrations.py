"""Helpers for reading installed-integration config off the encrypted store."""
from __future__ import annotations

import json

from fastapi import HTTPException, status

from . import crypto, db
from .config import get_settings


async def get_config(app_slug: str, *, required: bool = True) -> dict:
    """Return the decrypted config dict for an installed, enabled integration.

    Raises 400 when the integration is missing/disabled and `required` is True;
    otherwise returns {} in that case.
    """
    row = await db.pool().fetchrow(
        "SELECT config_encrypted, enabled FROM installed_integrations WHERE app_slug = $1",
        app_slug,
    )
    if not row or not row["enabled"]:
        if required:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"'{app_slug}' entegrasyonu kurulu/etkin değil. Marketplace'ten kurun.",
            )
        return {}
    blob = row["config_encrypted"]
    if not blob:
        return {}
    try:
        return json.loads(crypto.decrypt(get_settings().rafine_master_key, blob))
    except Exception:  # noqa: BLE001
        return {}
