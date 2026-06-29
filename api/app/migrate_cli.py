"""Standalone migration runner.

Runs the same migrations the api applies on startup, but on demand:

    python -m app.migrate_cli

Useful as a one-shot step (e.g. `docker compose run --rm api python -m app.migrate_cli`)
or to verify the schema independently of the web process.
"""
from __future__ import annotations

import asyncio

from . import db
from .config import get_settings
from .migrate import run_migrations
from .seed import seed_owner


async def _main() -> None:
    settings = get_settings()
    pool = await db.connect(settings.database_url)
    async with pool.acquire() as conn:
        applied = await run_migrations(conn, settings.migrations_dir)
        print(f"migrations applied: {applied or 'none (already up to date)'}")
        created = await seed_owner(conn, settings.owner_email, settings.owner_password)
        print(f"owner seeded: {created}")
    await db.disconnect()


if __name__ == "__main__":
    asyncio.run(_main())
