"""Slack integration: list/follow channels, read messages, post replies.

Messages are fetched live from the Slack Web API using the stored bot token,
so no inbound webhook is required (suits on-prem). Followed channels are
persisted so the panel shows a stable channel list.
"""
from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status

from .. import db
from ..deps import CurrentUser, get_current_user, require_admin
from ..integrations import get_config

router = APIRouter(prefix="/api/tools/slack", tags=["slack"])

_SLACK_API = "https://slack.com/api"


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
