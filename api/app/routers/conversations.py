"""Conversations, messages, and the chat proxy to the gateway."""
from __future__ import annotations

import base64
import json
import re
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from .. import db, signing
from ..config import Settings, get_settings
from ..deps import CurrentUser, get_current_user, require_admin
from pydantic import BaseModel

from ..schemas import (
    ChatReply,
    ChatRequest,
    ConversationCreate,
    ConversationOut,
    MessageOut,
)


class ConversationPatch(BaseModel):
    provider_id: str

router = APIRouter(prefix="/api/conversations", tags=["conversations"])
admin_router = APIRouter(prefix="/api/admin/conversations", tags=["admin-conversations"])


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


@router.patch("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def patch_conversation(
    conversation_id: str,
    body: ConversationPatch,
    user: CurrentUser = Depends(get_current_user),
):
    await _owned_conversation(conversation_id, user.id)
    provider = await db.pool().fetchrow(
        "SELECT default_model, is_active FROM llm_providers WHERE id = $1", body.provider_id
    )
    if not provider:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown provider")
    if not provider["is_active"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "provider is disabled")
    await db.pool().execute(
        "UPDATE conversations SET provider_id = $1, model = $2, updated_at = now() WHERE id = $3",
        body.provider_id, provider["default_model"], conversation_id,
    )


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
    messages = [{"role": r["role"], "content": _build_llm_content(r["content"], settings.uploads_dir)} for r in history]

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


_ATT_RE = re.compile(r'\n\n<!--rafine-attachments:(\[[\s\S]*?\])-->$')


def _build_llm_content(content: str, uploads_dir: str) -> "str | list":
    """Return LLM-ready content for a stored message.

    Plain text messages pass through unchanged. Messages with image attachments
    are expanded into an OpenAI multipart content array so the model can see them.
    """
    m = _ATT_RE.search(content)
    if not m:
        return content

    try:
        attachments = json.loads(m.group(1))
    except (json.JSONDecodeError, ValueError):
        return content

    text = content[: m.start()].strip()

    image_parts: list[dict] = []
    for att in attachments:
        ct = att.get("content_type", "")
        if not ct.startswith("image/"):
            continue
        url = att.get("url", "")
        if not url.startswith("/uploads/"):
            continue
        file_path = Path(uploads_dir) / url[len("/uploads/"):]
        try:
            if file_path.is_file():
                b64 = base64.b64encode(file_path.read_bytes()).decode()
                image_parts.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{ct};base64,{b64}"},
                })
        except Exception:
            pass

    if not image_parts:
        return text or content

    parts: list[dict] = []
    if text:
        parts.append({"type": "text", "text": text})
    parts.extend(image_parts)
    return parts


async def _prepare_chat(conversation_id: str, user_id: str, content: str, settings: Settings):
    """Shared setup for chat: validate, persist the user turn, build history + key."""
    convo = await _owned_conversation(conversation_id, user_id)
    if not convo["provider_id"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "conversation has no provider")

    await db.pool().execute(
        "INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', $2)",
        conversation_id, content,
    )
    history = await db.pool().fetch(
        "SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at",
        conversation_id,
    )
    messages = [{"role": r["role"], "content": _build_llm_content(r["content"], settings.uploads_dir)} for r in history]
    gw_key = signing.sign(
        settings.rafine_master_key, user_id=user_id,
        key_id=f"user:{user_id}", provider_id=convo["provider_id"],
    )
    return convo, messages, gw_key


@router.post("/{conversation_id}/chat/stream")
async def chat_stream(
    conversation_id: str,
    body: ChatRequest,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    """Streaming chat: proxies the gateway SSE to the client and persists the
    assembled assistant message once the stream completes."""
    convo, messages, gw_key = await _prepare_chat(
        conversation_id, user.id, body.content, settings
    )

    async def event_stream():
        collected: list[str] = []
        completion_tokens = 0
        had_error = False

        def _err_chunk(msg: str) -> str:
            nonlocal had_error
            had_error = True
            # Prefix so the client can distinguish error deltas from real content.
            err_payload = {"error": True, "choices": [{"delta": {"content": msg}}]}
            return f"data: {json.dumps(err_payload)}\n\n"

        try:
            async with httpx.AsyncClient(timeout=120) as client:
                async with client.stream(
                    "POST",
                    f"{settings.gateway_url}/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {gw_key}",
                        "X-Rafine-Provider": convo["provider_id"],
                        "X-Rafine-Conversation": conversation_id,
                    },
                    json={"model": convo["model"], "messages": messages, "stream": True},
                ) as resp:
                    if resp.status_code >= 400:
                        await resp.aread()
                        detail = resp.text
                        dl = detail.lower()
                        if "oauth_required" in detail or "missing_credential" in detail:
                            msg = "⚠️ API anahtarı bulunamadı. Bağlantılarım sayfasından kendi anahtarınızı ekleyin."
                        elif "unknown_provider" in detail:
                            msg = "⚠️ Sağlayıcı konfigürasyonu bulunamadı. Gateway henüz senkronize olmamış olabilir (10 sn bekleyin)."
                        elif "provider_disabled" in detail:
                            msg = "⚠️ Bu sağlayıcı devre dışı bırakılmış. Yöneticinize danışın."
                        elif "invalid_api_key" in detail or "api_key_invalid" in dl or ("invalid" in dl and "key" in dl):
                            msg = "⚠️ API anahtarı geçersiz veya süresi dolmuş. Bağlantılarım'dan anahtarınızı güncelleyin."
                        elif "rate_limit" in dl or "quota" in dl or "rate limit" in dl:
                            msg = "⚠️ İstek/kota limitine ulaşıldı."
                        elif "policy_blocked" in detail:
                            msg = "⚠️ Mesajınız içerik politikası tarafından engellendi."
                        elif "upstream_error" in detail:
                            try:
                                upstream_msg = json.loads(detail).get("error", {}).get("message", "")
                            except Exception:
                                upstream_msg = ""
                            if upstream_msg:
                                msg = f"⚠️ Sağlayıcı hatası: {upstream_msg[:300]}"
                            else:
                                msg = "⚠️ LLM sağlayıcısından hata döndü. Lütfen daha sonra tekrar deneyin."
                        else:
                            msg = f"⚠️ Sağlayıcı hatası (HTTP {resp.status_code}). Lütfen yöneticinize bildirin."
                        yield _err_chunk(msg)
                        yield "data: [DONE]\n\n"
                        return
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        payload = line[len("data:"):].strip()
                        yield f"data: {payload}\n\n"
                        if payload == "[DONE]":
                            break
                        try:
                            chunk = json.loads(payload)
                        except json.JSONDecodeError:
                            continue
                        for ch in chunk.get("choices", []):
                            piece = ch.get("delta", {}).get("content")
                            if piece:
                                collected.append(piece)
                        if chunk.get("usage"):
                            completion_tokens = chunk["usage"].get("completion_tokens", 0)
        except httpx.ConnectError:
            yield _err_chunk(
                "⚠️ Gateway'e bağlanılamadı. Servis başlatılıyor olabilir, lütfen birkaç saniye bekleyin."
            )
            yield "data: [DONE]\n\n"
        except httpx.TimeoutException:
            yield _err_chunk("⚠️ Gateway zaman aşımına uğradı.")
            yield "data: [DONE]\n\n"
        except Exception as exc:  # noqa: BLE001
            yield _err_chunk(f"⚠️ Beklenmeyen hata: {type(exc).__name__}")
            yield "data: [DONE]\n\n"
        finally:
            content = "".join(collected)
            # Never persist error messages as assistant turns.
            if content and not had_error:
                await db.pool().execute(
                    "INSERT INTO messages (conversation_id, role, content, tokens) "
                    "VALUES ($1, 'assistant', $2, $3)",
                    conversation_id, content, completion_tokens,
                )
                await db.pool().execute(
                    "UPDATE conversations SET updated_at = now() WHERE id = $1",
                    conversation_id,
                )

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


# ---------------------------------------------------------------------------
# Admin read-only conversation browser
# ---------------------------------------------------------------------------

@admin_router.get("")
async def admin_list_conversations(
    _: CurrentUser = Depends(require_admin),
    user_id: str | None = None,
    limit: int = 200,
    offset: int = 0,
):
    where, args = [], []
    if user_id:
        args.append(user_id)
        where.append(f"c.user_id = ${len(args)}")
    clause = ("WHERE " + " AND ".join(where)) if where else ""
    args += [limit, offset]
    rows = await db.pool().fetch(
        f"""
        SELECT c.id::text AS id, c.user_id::text AS user_id,
               u.email AS user_email,
               c.provider_id::text AS provider_id, c.model, c.title,
               c.updated_at
        FROM conversations c
        JOIN users u ON u.id = c.user_id
        {clause}
        ORDER BY c.updated_at DESC
        LIMIT ${len(args) - 1} OFFSET ${len(args)}
        """,
        *args,
    )
    return [
        dict(r) | {"updated_at": r["updated_at"].isoformat()}
        for r in rows
    ]


@admin_router.get("/{conversation_id}/messages")
async def admin_list_messages(
    conversation_id: str,
    _: CurrentUser = Depends(require_admin),
):
    rows = await db.pool().fetch(
        "SELECT id::text AS id, role, content, tokens, created_at "
        "FROM messages WHERE conversation_id = $1 ORDER BY created_at",
        conversation_id,
    )
    return [dict(r) | {"created_at": r["created_at"].isoformat()} for r in rows]
