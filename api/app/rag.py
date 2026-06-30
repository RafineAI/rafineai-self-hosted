"""RAG helpers: text extraction, chunking, and OpenAI embeddings.

Embeddings use the user's OpenAI key (BYOK) or the shared OpenAI provider key.
Vectors are stored in pgvector via their text representation and compared with
exact cosine distance, always scoped to one embed_model.
"""
from __future__ import annotations

import io

import httpx
from fastapi import HTTPException, status

from . import crypto, db
from .config import Settings

EMBED_MODEL = "text-embedding-3-small"
CHUNK_CHARS = 1200
CHUNK_OVERLAP = 150


def extract_text(filename: str, mime: str, data: bytes) -> str:
    """Best-effort text extraction for indexable document types."""
    if mime == "application/pdf" or filename.lower().endswith(".pdf"):
        try:
            from pypdf import PdfReader

            reader = PdfReader(io.BytesIO(data))
            return "\n".join((page.extract_text() or "") for page in reader.pages)
        except Exception:  # noqa: BLE001
            return ""
    # Text-ish types decode directly.
    if (
        mime.startswith("text/")
        or "json" in mime or "xml" in mime or "csv" in mime
        or "javascript" in mime or "markdown" in mime
        or filename.lower().endswith((".txt", ".md", ".csv", ".json", ".py", ".ts", ".js"))
    ):
        return data.decode("utf-8", errors="replace")
    return ""


def chunk_text(text: str) -> list[str]:
    text = text.strip()
    if not text:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + CHUNK_CHARS, len(text))
        chunks.append(text[start:end])
        if end == len(text):
            break
        start = end - CHUNK_OVERLAP
    return chunks


async def openai_key(user_id: str, settings: Settings) -> tuple[str, str]:
    """(api_key, base_url) for OpenAI — BYOK first, then shared provider key."""
    own = await db.pool().fetchval(
        "SELECT encrypted_key FROM user_own_keys WHERE user_id = $1 AND provider_type = 'openai'",
        user_id,
    )
    base = "https://api.openai.com/v1"
    if own:
        return crypto.decrypt(settings.rafine_master_key, own), base
    shared = await db.pool().fetchrow(
        "SELECT api_key_encrypted, base_url FROM llm_providers "
        "WHERE type = 'openai' AND api_key_encrypted IS NOT NULL AND api_key_encrypted <> '' "
        "ORDER BY created_at LIMIT 1"
    )
    if shared:
        return (
            crypto.decrypt(settings.rafine_master_key, shared["api_key_encrypted"]),
            (shared["base_url"] or base).rstrip("/"),
        )
    raise HTTPException(
        status.HTTP_400_BAD_REQUEST,
        "Embedding için OpenAI anahtarı gerekli. Bağlantılarım'dan ekleyin.",
    )


async def embed(texts: list[str], user_id: str, settings: Settings) -> list[list[float]]:
    """Embed a batch of texts with OpenAI; returns one vector per input."""
    key, base = await openai_key(user_id, settings)
    out: list[list[float]] = []
    async with httpx.AsyncClient(timeout=120, headers={"Authorization": f"Bearer {key}"}) as client:
        # Batch to stay well under request limits.
        for i in range(0, len(texts), 96):
            batch = texts[i:i + 96]
            resp = await client.post(f"{base}/embeddings", json={"model": EMBED_MODEL, "input": batch})
            if resp.status_code >= 400:
                raise HTTPException(resp.status_code, f"Embedding hatası: {resp.text[:200]}")
            for item in resp.json()["data"]:
                out.append(item["embedding"])
    return out


def to_pgvector(vec: list[float]) -> str:
    """pgvector text literal, e.g. '[0.1,0.2,...]'."""
    return "[" + ",".join(f"{x:.7g}" for x in vec) + "]"
