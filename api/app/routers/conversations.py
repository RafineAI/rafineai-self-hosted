"""Conversations, messages, and the chat proxy to the gateway."""
from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, status

from .. import db, signing
from ..config import Settings, get_settings
from ..deps import CurrentUser, get_current_user
from ..schemas import (
    ChatReply,
    ChatRequest,
    ConversationCreate,
    ConversationOut,
    MessageOut,
)

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


async def _owned_conversation(conversation_id: str, user_id: str):
    row = await db.pool().fetchrow(
        "SELECT id::text AS id, user_id::text AS user_id, provider_id::text AS provider_id, "
        "model, title FROM conversations WHERE id = $1",
        conversation_id,
    )
    if not row or row["user_id"] != user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found")
    return row


@router.get("", response_model=list[ConversationOut])
async def list_conversations(user: CurrentUser = Depends(get_current_user)):
    rows = await db.pool().fetch(
        "SELECT id::text AS id, provider_id::text AS provider_id, model, title "
        "FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC",
        user.id,
    )
    return [ConversationOut(**dict(r)) for r in rows]


@router.post("", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
async def create_conversation(
    body: ConversationCreate, user: CurrentUser = Depends(get_current_user)
):
    provider = await db.pool().fetchrow(
        "SELECT default_model, is_active FROM llm_providers WHERE id = $1", body.provider_id
    )
    if not provider:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown provider")
    if not provider["is_active"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "provider is disabled")
    model = body.model or provider["default_model"]
    row = await db.pool().fetchrow(
        """
        INSERT INTO conversations (user_id, provider_id, model, title)
        VALUES ($1, $2, $3, $4)
        RETURNING id::text AS id, provider_id::text AS provider_id, model, title
        """,
        user.id, body.provider_id, model, body.title,
    )
    return ConversationOut(**dict(row))


@router.get("/{conversation_id}/messages", response_model=list[MessageOut])
async def list_messages(
    conversation_id: str, user: CurrentUser = Depends(get_current_user)
):
    await _owned_conversation(conversation_id, user.id)
    rows = await db.pool().fetch(
        "SELECT id::text AS id, role, content, tokens FROM messages "
        "WHERE conversation_id = $1 ORDER BY created_at",
        conversation_id,
    )
    return [MessageOut(**dict(r)) for r in rows]


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(
    conversation_id: str, user: CurrentUser = Depends(get_current_user)
):
    await _owned_conversation(conversation_id, user.id)
    await db.pool().execute("DELETE FROM conversations WHERE id = $1", conversation_id)


@router.post("/{conversation_id}/chat", response_model=ChatReply)
async def chat(
    conversation_id: str,
    body: ChatRequest,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    convo = await _owned_conversation(conversation_id, user.id)
    if not convo["provider_id"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "conversation has no provider")

    # Persist the user's message.
    await db.pool().execute(
        "INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', $2)",
        conversation_id, body.content,
    )

    # Build the full message history for context.
    history = await db.pool().fetch(
        "SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at",
        conversation_id,
    )
    messages = [{"role": r["role"], "content": r["content"]} for r in history]

    # Mint a short-lived signed gateway key bound to this user + provider.
    gw_key = signing.sign(
        settings.rafine_master_key,
        user_id=user.id,
        key_id=f"user:{user.id}",
        provider_id=convo["provider_id"],
    )

    async with httpx.AsyncClient(timeout=120) as client:
        try:
            resp = await client.post(
                f"{settings.gateway_url}/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {gw_key}",
                    "X-Rafine-Provider": convo["provider_id"],
                    "X-Rafine-Conversation": conversation_id,
                },
                json={"model": convo["model"], "messages": messages},
            )
        except httpx.HTTPError as exc:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"gateway unreachable: {exc}")

    if resp.status_code >= 400:
        raise HTTPException(resp.status_code, f"gateway error: {resp.text}")

    data = resp.json()
    content = data["choices"][0]["message"]["content"]
    completion_tokens = data.get("usage", {}).get("completion_tokens", 0)

    row = await db.pool().fetchrow(
        """
        INSERT INTO messages (conversation_id, role, content, tokens)
        VALUES ($1, 'assistant', $2, $3)
        RETURNING id::text AS id, role, content, tokens
        """,
        conversation_id, content, completion_tokens,
    )
    # Touch the conversation so it sorts to the top.
    await db.pool().execute(
        "UPDATE conversations SET updated_at = now() WHERE id = $1", conversation_id
    )
    return ChatReply(message=MessageOut(**dict(row)))
