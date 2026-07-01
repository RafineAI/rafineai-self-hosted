"""Slack integration: list/follow channels, read messages, post replies.

Messages are fetched live from the Slack Web API using the stored bot token,
so no inbound webhook is required for browsing (suits on-prem). Followed
channels are persisted so the panel shows a stable channel list.

In addition, an optional inbound Events API webhook (`POST /events`) lets the
bot auto-reply when it is @-mentioned: the mention text is routed through the
gateway (which runs the content-policy engine and raises alerts) and the
generated reply is posted back in the same thread. This requires the app's
Signing Secret to be configured and an `app_mention` event subscription.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import re
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from .. import db, llm
from ..config import Settings, get_settings
from ..deps import CurrentUser, get_current_user, require_admin
from ..integrations import get_config

log = logging.getLogger("rafineai.slack")

router = APIRouter(prefix="/api/tools/slack", tags=["slack"])

_SLACK_API = "https://slack.com/api"

# Slack renders mentions as <@U123> or <@U123|name>; strip them from the text
# we send to the LLM so the model sees a clean prompt.
_MENTION_RE = re.compile(r"<@[^>]+>")


async def _call(method: str, *, params: dict | None = None, json_body: dict | None = None):
    cfg = await get_config("slack")
    token = cfg.get("bot_token")
    if not token:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Slack bot token yapılandırılmamış")
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=30, base_url=_SLACK_API, headers=headers) as client:
        try:
            if json_body is not None:
                headers["Content-Type"] = "application/json; charset=utf-8"
                resp = await client.post(f"/{method}", json=json_body, headers=headers)
            else:
                resp = await client.get(f"/{method}", params=params)
        except httpx.HTTPError as exc:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Slack'e ulaşılamadı: {exc}")
    data = resp.json()
    if not data.get("ok"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Slack hatası: {data.get('error', 'bilinmiyor')}")
    return data


@router.get("/channels")
async def list_channels(_: CurrentUser = Depends(get_current_user)):
    """Slack channels the bot can see, annotated with follow state."""
    data = await _call("conversations.list", params={"types": "public_channel,private_channel", "limit": 200})
    followed = {r["channel_id"] for r in await db.pool().fetch("SELECT channel_id FROM slack_channels")}
    return [
        {"id": c["id"], "name": c.get("name", c["id"]), "followed": c["id"] in followed}
        for c in data.get("channels", [])
    ]


@router.get("/followed")
async def followed_channels(_: CurrentUser = Depends(get_current_user)):
    rows = await db.pool().fetch(
        "SELECT channel_id, channel_name FROM slack_channels ORDER BY channel_name"
    )
    return [{"id": r["channel_id"], "name": r["channel_name"]} for r in rows]


@router.post("/follow", status_code=status.HTTP_204_NO_CONTENT)
async def follow(body: dict, _: CurrentUser = Depends(require_admin)):
    await db.pool().execute(
        "INSERT INTO slack_channels (channel_id, channel_name) VALUES ($1, $2) "
        "ON CONFLICT (channel_id) DO UPDATE SET channel_name = $2",
        body.get("id"), body.get("name", ""),
    )


@router.delete("/follow/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unfollow(channel_id: str, _: CurrentUser = Depends(require_admin)):
    await db.pool().execute("DELETE FROM slack_channels WHERE channel_id = $1", channel_id)


@router.get("/messages")
async def messages(
    channel: str = Query(...),
    _: CurrentUser = Depends(get_current_user),
):
    data = await _call("conversations.history", params={"channel": channel, "limit": 50})
    msgs = data.get("messages", [])
    # Resolve user ids to display names (best-effort, cached per call).
    names: dict[str, str] = {}
    out = []
    for m in reversed(msgs):  # oldest first for chat-like display
        uid = m.get("user", "")
        if uid and uid not in names:
            try:
                info = await _call("users.info", params={"user": uid})
                names[uid] = info["user"]["profile"].get("display_name") or info["user"].get("name", uid)
            except HTTPException:
                names[uid] = uid
        out.append({
            "ts": m.get("ts", ""),
            "user": names.get(uid, m.get("username", "bot")),
            "text": m.get("text", ""),
        })
    return out


@router.post("/send", status_code=status.HTTP_204_NO_CONTENT)
async def send_message(body: dict, _: CurrentUser = Depends(get_current_user)):
    channel = body.get("channel")
    text = body.get("text", "")
    if not channel or not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "channel ve text gerekli")
    await _call("chat.postMessage", json_body={"channel": channel, "text": text})


_CHANNEL_ID_RE = re.compile(r"^[CG][A-Z0-9]+$")


async def channel_context(channel_ref: str, limit: int = 30) -> tuple[str, str]:
    """(label, recent-messages) for the chat context-attach feature.

    Accepts a channel id (Cxxx/Gxxx) or a #name that is already followed.
    """
    ref = channel_ref.strip().lstrip("#")
    channel_id = ref
    if not _CHANNEL_ID_RE.match(ref):
        rows = await db.pool().fetch(
            "SELECT channel_id, channel_name FROM slack_channels WHERE channel_name = $1", ref
        )
        if not rows:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Kanal bulunamadı. Kanal id'si (Cxxx) veya takip edilen bir #kanal adı girin.",
            )
        channel_id = rows[0]["channel_id"]
    data = await _call("conversations.history", params={"channel": channel_id, "limit": limit})
    lines = [
        f"{m.get('user', m.get('username', 'bot'))}: {m.get('text', '')}"
        for m in reversed(data.get("messages", []))
    ]
    return f"Slack: #{ref}", "\n".join(lines) or "(kanalda mesaj yok)"


# ---------------------------------------------------------------------------
# Inbound Events API: auto-reply to @-mentions (policy-checked via the gateway)
# ---------------------------------------------------------------------------


def _verify_signature(secret: str, timestamp: str, signature: str, raw_body: bytes) -> bool:
    """Verify Slack's request signature (HMAC-SHA256 over v0:ts:body)."""
    if not (secret and timestamp and signature):
        return False
    try:
        # Reject stale requests (replay protection): older than 5 minutes.
        if abs(time.time() - int(timestamp)) > 60 * 5:
            return False
    except ValueError:
        return False
    base = f"v0:{timestamp}:{raw_body.decode('utf-8', 'replace')}"
    digest = hmac.new(secret.encode(), base.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"v0={digest}", signature)


async def _mark_event(event_id: str) -> bool:
    """Record a Slack event id; return True only the first time (dedup retries)."""
    if not event_id:
        return True  # no id to dedup on — process it
    res = await db.pool().execute(
        "INSERT INTO slack_events_seen (event_id) VALUES ($1) ON CONFLICT DO NOTHING",
        event_id,
    )
    return res.endswith("1")


async def _bot_user() -> CurrentUser | None:
    """The identity the bot answers as: whoever installed the Slack integration.

    Its usable provider (shared key / BYOK / OAuth) drives the auto-reply, and
    policy alerts raised by the gateway are attributed to this user.
    """
    row = await db.pool().fetchrow(
        "SELECT installed_by::text AS uid FROM installed_integrations WHERE app_slug = 'slack'"
    )
    if not row or not row["uid"]:
        return None
    urow = await db.pool().fetchrow(
        "SELECT id::text AS id, role FROM users WHERE id = $1 AND is_active", row["uid"]
    )
    return CurrentUser(id=urow["id"], role=urow["role"]) if urow else None


async def _handle_mention(event: dict, settings: Settings) -> None:
    """Generate a policy-checked reply and post it back in the mention's thread."""
    try:
        # Ignore anything the bot (or another bot) posted, to avoid reply loops.
        if event.get("bot_id"):
            return
        channel = event.get("channel")
        if not channel:
            return
        text = _MENTION_RE.sub("", event.get("text", "")).strip()
        if not text:
            return
        user = await _bot_user()
        if not user:
            log.warning("slack auto-reply skipped: no installer identity/provider")
            return

        # Routing through the gateway runs the content-policy engine (raising
        # admin alerts for any match) and returns the completion in one call.
        reply = await llm.quick_complete(user, text, settings)

        # Reply in-thread: use the parent thread if present, else the message ts.
        thread_ts = event.get("thread_ts") or event.get("ts")
        await _call("chat.postMessage", json_body={
            "channel": channel, "text": reply, "thread_ts": thread_ts,
        })
    except Exception:  # noqa: BLE001 — background task must never crash the loop
        log.exception("slack mention handling failed")


@router.post("/events")
async def slack_events(request: Request, settings: Settings = Depends(get_settings)):
    """Slack Events API endpoint. Verified by the app Signing Secret (no JWT).

    Handles the one-time url_verification handshake and `app_mention` events.
    Replies are generated asynchronously so Slack still gets its <3s 200 ack.
    """
    raw = await request.body()
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid payload")

    # URL verification handshake (Slack calls this when you set the Request URL).
    # It carries no side effects, so we echo the challenge without requiring the
    # signature — this lets the URL be verified even before the Signing Secret is
    # saved in the panel (avoids a setup chicken-and-egg).
    if payload.get("type") == "url_verification":
        return {"challenge": payload.get("challenge", "")}

    # Every real event must be signature-verified with the app Signing Secret.
    cfg = await get_config("slack", required=False)
    if not _verify_signature(
        cfg.get("signing_secret", ""),
        request.headers.get("X-Slack-Request-Timestamp", ""),
        request.headers.get("X-Slack-Signature", ""),
        raw,
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid slack signature")

    if payload.get("type") == "event_callback":
        event = payload.get("event", {})
        if event.get("type") == "app_mention" and await _mark_event(payload.get("event_id", "")):
            # Fire-and-forget so we can ack immediately; errors are logged inside.
            asyncio.create_task(_handle_mention(event, settings))

    return {"ok": True}
