"""Light-weight API key validation helpers.

We do a quick GET /models (or equivalent) against the provider's endpoint.
Only explicit 401/403 responses are treated as "key invalid" — network errors
and 5xx responses are silently ignored so a transient outage doesn't prevent
admins from saving provider config.
"""
from __future__ import annotations

import httpx
from fastapi import HTTPException, status


async def validate_api_key(
    provider_type: str,
    api_key: str,
    base_url: str | None = None,
) -> None:
    """Raise HTTP 422 if the key is demonstrably rejected by the provider."""
    url, headers = _build_test_request(provider_type, api_key, base_url)
    if not url:
        return

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(url, headers=headers)
        if resp.status_code in (401, 403):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "API key geçersiz veya yetkisiz. Lütfen anahtarı kontrol edin.",
            )
    except HTTPException:
        raise
    except Exception:
        # Timeout, DNS, SSL errors → don't block saving
        pass


def _build_test_request(
    provider_type: str, api_key: str, base_url: str | None
) -> tuple[str | None, dict]:
    if base_url:
        return f"{base_url.rstrip('/')}/models", {"Authorization": f"Bearer {api_key}"}
    if provider_type == "openai":
        return "https://api.openai.com/v1/models", {"Authorization": f"Bearer {api_key}"}
    if provider_type == "anthropic":
        return (
            "https://api.anthropic.com/v1/models",
            {"x-api-key": api_key, "anthropic-version": "2023-06-01"},
        )
    if provider_type == "gemini":
        return f"https://generativelanguage.googleapis.com/v1/models?key={api_key}", {}
    return None, {}
