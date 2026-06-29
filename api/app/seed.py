"""Seed the default owner account on first boot (idempotent)."""
from __future__ import annotations

import asyncpg

from .security import hash_password


async def seed_owner(conn: asyncpg.Connection, email: str, password: str) -> bool:
    """Create the owner if no owner exists. Returns True if created."""
    existing = await conn.fetchval("SELECT 1 FROM users WHERE role = 'owner' LIMIT 1")
    if existing:
        return False
    await conn.execute(
        """
        INSERT INTO users (email, password_hash, role, is_active)
        VALUES ($1, $2, 'owner', TRUE)
        ON CONFLICT (email) DO NOTHING
        """,
        email,
        hash_password(password),
    )
    return True
