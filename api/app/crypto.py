"""Symmetric encryption for provider credentials.

Scheme (must match the Go gateway in internal/secretbox):
  key   = SHA256(master_key)            # 32 bytes -> AES-256
  nonce = 12 random bytes
  blob  = base64std( nonce || AES-GCM-seal(key, nonce, plaintext) )
"""
from __future__ import annotations

import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_NONCE_LEN = 12


def _derive_key(master_key: str) -> bytes:
    return hashlib.sha256(master_key.encode()).digest()


def encrypt(master_key: str, plaintext: str) -> str:
    aes = AESGCM(_derive_key(master_key))
    nonce = os.urandom(_NONCE_LEN)
    sealed = aes.encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + sealed).decode()


def decrypt(master_key: str, blob: str) -> str:
    raw = base64.b64decode(blob)
    if len(raw) < _NONCE_LEN:
        raise ValueError("ciphertext too short")
    nonce, ct = raw[:_NONCE_LEN], raw[_NONCE_LEN:]
    aes = AESGCM(_derive_key(master_key))
    return aes.decrypt(nonce, ct, None).decode()
