"""RAG / NotebookLM: index documents and ask questions grounded in them."""
from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, status

from .. import db, rag, signing, storage
from ..config import Settings, get_settings
from ..deps import CurrentUser, get_current_user

router = APIRouter(prefix="/api/rag", tags=["rag"])

TOP_K = 6


@router.post("/index/{document_id}")
async def index_document(
    document_id: str,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    doc = await db.pool().fetchrow(
        "SELECT filename, mime_type, storage_key FROM documents "
        "WHERE id = $1 AND owner_id = $2",
        document_id, user.id,
    )
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "belge bulunamadı")

    data = storage.get_storage(settings.storage_dir).read(doc["storage_key"])
    text = rag.extract_text(doc["filename"], doc["mime_type"], data)
    chunks = rag.chunk_text(text)
    if not chunks:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Belgeden metin çıkarılamadı (desteklenmeyen tür olabilir).")

    vectors = await rag.embed(chunks, user.id, settings)

    # Replace any prior index for this document.
    await db.pool().execute("DELETE FROM document_chunks WHERE document_id = $1", document_id)
    for i, (chunk, vec) in enumerate(zip(chunks, vectors)):
        await db.pool().execute(
            """
            INSERT INTO document_chunks (document_id, owner_id, chunk_index, content, embed_model, embedding)
            VALUES ($1, $2, $3, $4, $5, $6::vector)
            """,
            document_id, user.id, i, chunk, rag.EMBED_MODEL, rag.to_pgvector(vec),
        )
    await db.pool().execute("UPDATE documents SET indexed = TRUE WHERE id = $1", document_id)
    return {"chunks": len(chunks)}


@router.post("/ask")
async def ask(
    body: dict,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    question = (body.get("question") or "").strip()
    if not question:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "soru gerekli")
    document_ids = body.get("document_ids") or []

    qvec = (await rag.embed([question], user.id, settings))[0]

    # Retrieve nearest chunks (exact cosine distance), scoped to the user's
    # documents and the same embed model.
    params: list = [user.id, rag.EMBED_MODEL, rag.to_pgvector(qvec)]
    doc_filter = ""
    if document_ids:
        params.append(document_ids)
        doc_filter = "AND c.document_id = ANY($4::uuid[])"
    rows = await db.pool().fetch(
        f"""
        SELECT c.content, d.filename,
               (c.embedding <=> $3::vector) AS distance
        FROM document_chunks c
        JOIN documents d ON d.id = c.document_id
        WHERE c.owner_id = $1 AND c.embed_model = $2 {doc_filter}
        ORDER BY c.embedding <=> $3::vector
        LIMIT {TOP_K}
        """,
        *params,
    )
    if not rows:
        return {"answer": "Bu soruya yanıt verecek indekslenmiş belge bulunamadı. "
                          "Önce Belgelerim'den bir belgeyi indeksleyin.", "sources": []}

    context = "\n\n".join(f"[Kaynak: {r['filename']}]\n{r['content']}" for r in rows)
    prompt = (
        "Aşağıdaki belge alıntılarına dayanarak soruyu Türkçe yanıtla. Yalnızca "
        "verilen bağlamı kullan; bilgi yoksa 'Belgelerde bulamadım' de. Yanıtın "
        "sonunda kullandığın kaynak dosya adlarını listele.\n\n"
        f"=== BAĞLAM ===\n{context}\n\n=== SORU ===\n{question}"
    )

    # Reuse the gateway for the completion (policy + audit apply).
    answer = await _complete(user, prompt, settings)
    sources = list({r["filename"] for r in rows})
    return {"answer": answer, "sources": sources}


async def _complete(user: CurrentUser, prompt: str, settings: Settings) -> str:
    """Run the grounded prompt through the gateway with an OpenAI provider."""
    provider = await db.pool().fetchrow(
        "SELECT id::text AS id, default_model FROM llm_providers "
        "WHERE type = 'openai' AND is_active = TRUE ORDER BY created_at LIMIT 1"
    )
    if not provider:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Aktif bir OpenAI sağlayıcısı yok.")
    gw_key = signing.sign(
        settings.rafine_master_key, user_id=user.id,
        key_id=f"user:{user.id}", provider_id=provider["id"],
    )
    async with httpx.AsyncClient(timeout=120) as client:
        try:
            resp = await client.post(
                f"{settings.gateway_url}/v1/chat/completions",
                headers={"Authorization": f"Bearer {gw_key}", "X-Rafine-Provider": provider["id"]},
                json={"model": provider["default_model"],
                      "messages": [{"role": "user", "content": prompt}]},
            )
        except httpx.HTTPError:
            return "LLM gateway'e ulaşılamadı."
    if resp.status_code >= 400:
        return "LLM isteği başarısız oldu."
    try:
        return resp.json()["choices"][0]["message"]["content"]
    except Exception:  # noqa: BLE001
        return "Yanıt çözümlenemedi."
