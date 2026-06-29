"""Idempotent SQL migration runner.

Applies every `*.sql` file in the migrations directory in lexical order,
recording applied filenames in a `schema_migrations` table so re-runs are
no-ops. Runs on api startup.
"""
from __future__ import annotations

import os

import asyncpg


async def run_migrations(conn: asyncpg.Connection, migrations_dir: str) -> list[str]:
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename   TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )
    applied: set[str] = {
        r["filename"] for r in await conn.fetch("SELECT filename FROM schema_migrations")
    }

    if not os.path.isdir(migrations_dir):
        raise FileNotFoundError(f"migrations dir not found: {migrations_dir}")

    newly: list[str] = []
    for fname in sorted(os.listdir(migrations_dir)):
        if not fname.endswith(".sql") or fname in applied:
            continue
        with open(os.path.join(migrations_dir, fname), encoding="utf-8") as fh:
            sql = fh.read()
        async with conn.transaction():
            await conn.execute(sql)
            await conn.execute(
                "INSERT INTO schema_migrations (filename) VALUES ($1)", fname
            )
        newly.append(fname)
    return newly
