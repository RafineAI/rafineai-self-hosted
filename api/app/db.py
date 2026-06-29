"""asyncpg connection pool management."""
from __future__ import annotations

import asyncpg

_pool: asyncpg.Pool | None = None


def _normalize_dsn(dsn: str) -> str:
    # asyncpg understands postgres:// and postgresql:// but not the
    # SQLAlchemy-style +driver suffix.
    return dsn.replace("postgresql+asyncpg://", "postgresql://")


async def connect(dsn: str) -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(_normalize_dsn(dsn), min_size=1, max_size=10)
    return _pool


async def disconnect() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("database pool not initialized")
    return _pool
