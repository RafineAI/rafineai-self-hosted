"""Pluggable file storage.

The default backend writes to a local directory (a mounted volume in
production). The Storage protocol is intentionally small so an S3-compatible
backend can be dropped in later without touching callers.

Keys are namespaced by owner: "{owner_id}/{uuid}_{safe_filename}".
"""
from __future__ import annotations

import hashlib
import os
import re
import uuid
from pathlib import Path
from typing import Protocol

_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def safe_name(filename: str) -> str:
    """Sanitize a filename for use within a storage key."""
    base = os.path.basename(filename or "file")
    cleaned = _SAFE.sub("_", base).strip("._") or "file"
    return cleaned[:120]


def make_key(owner_id: str, filename: str) -> str:
    return f"{owner_id}/{uuid.uuid4().hex}_{safe_name(filename)}"


class Storage(Protocol):
    def save(self, key: str, data: bytes) -> None: ...
    def read(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...
    def path(self, key: str) -> str | None: ...


class LocalStorage:
    """Filesystem-backed storage rooted at `base_dir`."""

    def __init__(self, base_dir: str) -> None:
        self.base = Path(base_dir)
        self.base.mkdir(parents=True, exist_ok=True)

    def _full(self, key: str) -> Path:
        # Resolve and guard against path traversal outside the base dir.
        full = (self.base / key).resolve()
        if not str(full).startswith(str(self.base.resolve())):
            raise ValueError("invalid storage key")
        return full

    def save(self, key: str, data: bytes) -> None:
        full = self._full(key)
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_bytes(data)

    def read(self, key: str) -> bytes:
        return self._full(key).read_bytes()

    def delete(self, key: str) -> None:
        try:
            self._full(key).unlink()
        except FileNotFoundError:
            pass

    def path(self, key: str) -> str | None:
        return str(self._full(key))


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


_storage: Storage | None = None


def get_storage(base_dir: str) -> Storage:
    global _storage
    if _storage is None:
        _storage = LocalStorage(base_dir)
    return _storage
