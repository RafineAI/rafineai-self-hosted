"""Fine-tuning: start OpenAI fine-tune jobs from a stored training document and
track their status. Uses the user's own OpenAI key (BYOK) or the shared
OpenAI provider key.
"""
from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, HTTPException, status

from .. import crypto, db, storage
from ..config import Settings, get_settings
from ..deps import CurrentUser, get_current_user

router = APIRouter(prefix="/api/tools/finetune", tags=["finetune"])


async def _openai_key(user_id: str, settings: Settings) -> tuple[str, str]:
    """Return (api_key, base_url) for OpenAI: prefer the user's BYOK key, fall
    back to the shared provider key."""
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
    raise HTTPException(status.HTTP_400_BAD_REQUEST,
                        "OpenAI anahtarı yok. Bağlantılarım'dan kendi anahtarınızı ekleyin.")


@router.get("/jobs")
async def list_jobs(
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    rows = await db.pool().fetch(
        """
        SELECT id::text AS id, base_model, external_job_id, status,
               fine_tuned_model, error, created_at::text AS created_at
        FROM finetune_jobs WHERE owner_id = $1 ORDER BY created_at DESC
        """,
        user.id,
    )
    jobs = [dict(r) for r in rows]

    # Best-effort live status refresh for jobs still running.
    pending = [j for j in jobs if j["status"] not in ("succeeded", "failed", "cancelled") and j["external_job_id"]]
    if pending:
        try:
            key, base = await _openai_key(user.id, settings)
            async with httpx.AsyncClient(timeout=30, headers={"Authorization": f"Bearer {key}"}) as client:
                for j in pending:
                    resp = await client.get(f"{base}/fine_tuning/jobs/{j['external_job_id']}")
                    if resp.status_code < 400:
                        d = resp.json()
                        j["status"] = d.get("status", j["status"])
                        j["fine_tuned_model"] = d.get("fine_tuned_model") or ""
                        await db.pool().execute(
                            "UPDATE finetune_jobs SET status = $2, fine_tuned_model = $3 WHERE id = $1",
                            j["id"], j["status"], j["fine_tuned_model"],
                        )
        except HTTPException:
            pass  # surface stored status if refresh fails
    return jobs


@router.post("/jobs", status_code=status.HTTP_201_CREATED)
async def create_job(
    body: dict,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    document_id = body.get("document_id")
    base_model = body.get("base_model", "gpt-4o-mini-2024-07-18")
    if not document_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "eğitim belgesi seçilmedi")

    doc = await db.pool().fetchrow(
        "SELECT filename, storage_key FROM documents WHERE id = $1 AND owner_id = $2",
        document_id, user.id,
    )
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "belge bulunamadı")

    key, base = await _openai_key(user.id, settings)
    data = storage.get_storage(settings.storage_dir).read(doc["storage_key"])

    async with httpx.AsyncClient(timeout=120, headers={"Authorization": f"Bearer {key}"}) as client:
        # 1) Upload training file (purpose=fine-tune).
        try:
            up = await client.post(
                f"{base}/files",
                files={"file": (doc["filename"], data, "application/jsonl")},
                data={"purpose": "fine-tune"},
            )
        except httpx.HTTPError as exc:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"dosya yüklenemedi: {exc}")
        if up.status_code >= 400:
            raise HTTPException(up.status_code, f"OpenAI dosya hatası: {up.text[:300]}")
        file_id = up.json()["id"]

        # 2) Create the fine-tune job.
        job = await client.post(
            f"{base}/fine_tuning/jobs",
            json={"training_file": file_id, "model": base_model},
        )
        if job.status_code >= 400:
            raise HTTPException(job.status_code, f"OpenAI job hatası: {job.text[:300]}")
        jd = job.json()

    row = await db.pool().fetchrow(
        """
        INSERT INTO finetune_jobs
            (owner_id, provider_type, base_model, training_document_id,
             external_file_id, external_job_id, status)
        VALUES ($1, 'openai', $2, $3, $4, $5, $6)
        RETURNING id::text AS id
        """,
        user.id, base_model, document_id, file_id, jd["id"], jd.get("status", "queued"),
    )
    return {"id": row["id"], "external_job_id": jd["id"], "status": jd.get("status", "queued")}
