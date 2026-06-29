"""Mint HMAC-signed gateway API keys.

Format (must match the Go gateway in internal/signing):
  rk_<base64url(payloadJSON)>.<base64url(hmac_sha256(payloadB64, master_key))>

The HMAC is computed over the base64-encoded payload string, so the gateway
verifies without re-serializing JSON (key order is irrelevant).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

_PREFIX = "rk_"


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _mac(master_key: str, msg: str) -> bytes:
    return hmac.new(master_key.encode(), msg.encode(), hashlib.sha256).digest()


def sign(
    master_key: str,
    user_id: str,
    key_id: str,
    provider_id: str = "",
    issued_at: int | None = None,
) -> str:
    """Produce a signed gateway key for the given claims."""
    claims: dict[str, object] = {
        "uid": user_id,
        "kid": key_id,
        "iat": issued_at if issued_at is not None else int(time.time()),
    }
    if provider_id:
        claims["pid"] = provider_id
    payload = json.dumps(claims, separators=(",", ":")).encode()
    enc_payload = _b64url(payload)
    sig = _mac(master_key, enc_payload)
    return _PREFIX + enc_payload + "." + _b64url(sig)
