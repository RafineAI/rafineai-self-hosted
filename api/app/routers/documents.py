"""Internal document storage: upload, list, preview/download, delete.

Files are stored on the storage backend; metadata lives in the documents
table. Users see their own documents plus any shared with a team they belong
to. Inline preview is supported by serving the raw bytes with the stored
mime type (the panel renders images/PDF/text/code inline).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status

from .. import db, storage
from ..config import Settings, get_settings
from ..deps import CurrentUser, get_current_user
from ..schemas import DocumentOut

router = APIRouter(prefix="/api/documents", tags=["documents"])

_COLS = ("id::text AS id, filename, mime_type, size_bytes, sha256, "
        "indexed, team_id::text AS team_id, created_at::text AS created_at")


async def _visible_document(doc_id: str, user: CurrentUser):
    """Fetch a document the user may access (owner or same-team share)."""
    row = await db.pool().fetchrow(
        f"""
        SELECT {_COLS}, owner_id::text AS owner_id, storage_key
        FROM documents d
        WHERE d.id = $1
          AND (d.owner_id = $2
               OR d.team_id IN (SELECT team_id FROM team_members WHERE user_id = $2))
        """,
        doc_id, user.id,
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "document not found")
    return row


@router.get("", response_model=list[DocumentOut])
async def list_documents(user: CurrentUser = Depends(get_current_user)):
    rows = await db.pool().fetch(
        f"""
        SELECT {_COLS} FROM documents
        WHERE owner_id = $1
           OR team_id IN (SELECT team_id FROM team_members WHERE user_id = $1)
        ORDER BY created_at DESC
        """,
        user.id,
    )
    return [DocumentOut(**dict(r)) for r in rows]


@router.post("", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    data = await file.read()
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "dosya çok büyük")
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "boş dosya")

    store = storage.get_storage(settings.storage_dir)
    key = storage.make_key(user.id, file.filename or "file")
    store.save(key, data)

    row = await db.pool().fetchrow(
        f"""
        INSERT INTO documents (owner_id, filename, mime_type, size_bytes, sha256, storage_key)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING {_COLS}
        """,
        user.id,
        storage.safe_name(file.filename or "file"),
        file.content_type or "application/octet-stream",
        len(data),
        storage.sha256_hex(data),
        key,
    )
    return DocumentOut(**dict(row))


@router.get("/{doc_id}/content")
async def document_content(
    doc_id: str,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    row = await _visible_document(doc_id, user)
    store = storage.get_storage(settings.storage_dir)
    try:
        data = store.read(row["storage_key"])
    except FileNotFoundError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "dosya içeriği bulunamadı")
    return Response(
        content=data,
        media_type=row["mime_type"],
        headers={"Content-Disposition": f'inline; filename="{row["filename"]}"'},
    )


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    doc_id: str,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    row = await db.pool().fetchrow(
        "SELECT storage_key FROM documents WHERE id = $1 AND owner_id = $2",
        doc_id, user.id,
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "document not found")
    storage.get_storage(settings.storage_dir).delete(row["storage_key"])
    await db.pool().execute("DELETE FROM documents WHERE id = $1", doc_id)
