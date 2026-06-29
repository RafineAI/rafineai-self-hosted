"""Test fixtures: a real Postgres-backed app via httpx ASGITransport."""
from __future__ import annotations

import os
import pathlib

import pytest
import pytest_asyncio

# Configure the environment BEFORE importing the app.
REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
os.environ.setdefault(
    "DATABASE_URL",
    os.environ.get("TEST_DATABASE_URL", "postgresql://postgres@127.0.0.1:5433/rafineai_test"),
)
os.environ.setdefault("RAFINE_MASTER_KEY", "test-master-key-0123456789abcdef")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-0123456789abcdef")
os.environ.setdefault("OWNER_EMAIL", "owner@rafine.local")
os.environ.setdefault("OWNER_PASSWORD", "owner-password-123")
os.environ.setdefault("MIGRATIONS_DIR", str(REPO_ROOT / "db" / "migrations"))

import httpx  # noqa: E402

from app import db  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402
from app.migrate import run_migrations  # noqa: E402
from app.seed import seed_owner  # noqa: E402

TABLES = [
    "alerts", "policy_rules", "audit_logs", "messages", "conversations",
    "user_provider_tokens", "gateway_keys", "llm_providers", "users",
]


@pytest_asyncio.fixture
async def client():
    settings = get_settings()
    pool = await db.connect(settings.database_url)
    async with pool.acquire() as conn:
        await run_migrations(conn, settings.migrations_dir)
        await conn.execute("TRUNCATE " + ", ".join(TABLES) + " CASCADE")
        await seed_owner(conn, settings.owner_email, settings.owner_password)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c

    await db.disconnect()


async def login(client: httpx.AsyncClient, email: str, password: str) -> str:
    resp = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
