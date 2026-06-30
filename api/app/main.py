"""RafineAI management API (FastAPI).

On startup it connects to PostgreSQL, applies SQL migrations, and seeds the
default owner account. It then serves auth, user/provider management, the chat
proxy, and audit queries for the panel.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .config import get_settings
from .migrate import run_migrations
from .routers import (
    api_client,
    audit,
    auth,
    conversations,
    documents,
    finetune,
    github,
    marketplace,
    metrics,
    oauth,
    policy,
    providers,
    rag,
    sentry,
    slack,
    teams,
    user_keys,
    users,
)
from .seed import seed_owner

log = logging.getLogger("rafineai.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    pool = await db.connect(settings.database_url)
    async with pool.acquire() as conn:
        applied = await run_migrations(conn, settings.migrations_dir)
        if applied:
            log.info("applied migrations: %s", applied)
        created = await seed_owner(conn, settings.owner_email, settings.owner_password)
        if created:
            log.info("seeded owner account: %s", settings.owner_email)
    yield
    await db.disconnect()


app = FastAPI(title="RafineAI API", version="0.1.0", lifespan=lifespan)

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[_settings.rafine_public_url, "http://localhost:3000", "http://localhost"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(providers.router)
app.include_router(oauth.router)
app.include_router(conversations.router)
app.include_router(audit.router)
app.include_router(policy.router)
app.include_router(policy.alerts_router)
app.include_router(policy.settings_router)
app.include_router(user_keys.router)
app.include_router(documents.router)
app.include_router(teams.router)
app.include_router(metrics.router)
app.include_router(marketplace.router)
app.include_router(github.router)
app.include_router(api_client.router)
app.include_router(slack.router)
app.include_router(sentry.router)
app.include_router(finetune.router)
app.include_router(rag.router)


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}
