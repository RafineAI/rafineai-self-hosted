"""asyncpg connection pool management."""
from __future__ import annotations

import json

import asyncpg

_pool: asyncpg.Pool | None = None


async def _init_conn(conn: asyncpg.Connection) -> None:
    # Return JSONB columns as Python objects (lists/dicts) instead of raw text.
    await conn.set_type_codec(
        "jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
    )


def _normalize_dsn(dsn: str) -> str:
    # asyncpg understands postgres:// and postgresql:// but not the
    # SQLAlchemy-style +driver suffix.
    return dsn.replace("postgresql+asyncpg://", "postgresql://")


async def connect(dsn: str) -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(
            _normalize_dsn(dsn), min_size=1, max_size=10, init=_init_conn
        )
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
