"""File upload and serving endpoints."""
from __future__ import annotations

import mimetypes
import uuid
from pathlib import Path

import aiofiles
from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from .. import db
from ..config import Settings, get_settings
from ..deps import CurrentUser, get_current_user, require_admin

router = APIRouter(tags=["uploads"])

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"}
ALLOWED_UPLOAD_TYPES = ALLOWED_IMAGE_TYPES | {
    "application/pdf",
    "text/plain", "text/csv", "text/markdown",
    "application/json",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
MAX_LOGO_SIZE = 2 * 1024 * 1024    # 2 MB
MAX_FILE_SIZE = 20 * 1024 * 1024   # 20 MB
MAX_TEXT_CHARS = 30_000            # ~7-8k tokens, enough for most documents


def _safe_filename(name: str) -> str:
    """Strip path components and replace unsafe chars."""
    name = Path(name).name
    return "".join(c if c.isalnum() or c in "._-" else "_" for c in name)


def _extract_text(path: Path, content_type: str) -> str:
    """Return plain text extracted from the file, or empty string if unsupported."""
    try:
        if content_type == "application/pdf":
            import pdfplumber
            parts: list[str] = []
            with pdfplumber.open(path) as pdf:
                for page in pdf.pages[:30]:  # cap at 30 pages
                    text = page.extract_text()
                    if text:
                        parts.append(text.strip())
            return "\n\n".join(parts)[:MAX_TEXT_CHARS]

        if content_type in {"text/plain", "text/csv", "text/markdown", "application/json"}:
            return path.read_text(errors="ignore")[:MAX_TEXT_CHARS]

    except Exception:
        pass
    return ""


@router.post("/api/uploads/logo")
async def upload_logo(
    file: UploadFile,
    _: CurrentUser = Depends(require_admin),
    settings: Settings = Depends(get_settings),
):
    content_type = file.content_type or ""
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Only image files are allowed for the logo")

    data = await file.read()
    if len(data) > MAX_LOGO_SIZE:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Logo must be under 2 MB")

    ext = mimetypes.guess_extension(content_type) or ".png"
    if ext == ".jpe":
        ext = ".jpg"

    logo_dir = Path(settings.uploads_dir) / "logo"
    logo_dir.mkdir(parents=True, exist_ok=True)
    dest = logo_dir / f"logo{ext}"

    async with aiofiles.open(dest, "wb") as f:
        await f.write(data)

    url = f"/uploads/logo/logo{ext}"
    await db.pool().execute(
        "INSERT INTO app_settings (key, value, updated_at) VALUES ('app_logo_url', $1, now()) "
        "ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = now()",
        url,
    )
    return {"url": url}


@router.post("/api/conversations/{conversation_id}/upload")
async def upload_attachment(
    conversation_id: str,
    file: UploadFile,
    user: CurrentUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    # Verify conversation ownership
    row = await db.pool().fetchrow(
        "SELECT id FROM conversations WHERE id = $1 AND user_id = $2",
        conversation_id, user.id,
    )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found")

    content_type = file.content_type or "application/octet-stream"
    if content_type not in ALLOWED_UPLOAD_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, f"File type not allowed: {content_type}")

    data = await file.read()
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File must be under 20 MB")

    safe_name = _safe_filename(file.filename or "file")
    unique_name = f"{uuid.uuid4().hex[:8]}-{safe_name}"

    upload_dir = Path(settings.uploads_dir) / "chat" / conversation_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    dest = upload_dir / unique_name

    async with aiofiles.open(dest, "wb") as f:
        await f.write(data)

    text_content = _extract_text(dest, content_type)

    url = f"/uploads/chat/{conversation_id}/{unique_name}"
    return {
        "url": url,
        "filename": file.filename or safe_name,
        "content_type": content_type,
        "size": len(data),
        "text_content": text_content,
    }


@router.get("/uploads/{path:path}")
async def serve_file(
    path: str,
    settings: Settings = Depends(get_settings),
):
    """Serve uploaded files. Logo is public; chat files require authentication
    (checked by nginx in production, served directly here in dev)."""
    full_path = Path(settings.uploads_dir) / path
    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "file not found")
    try:
        full_path.relative_to(Path(settings.uploads_dir))
    except ValueError:
        raise HTTPException(status.HTTP_403_FORBIDDEN)
    return FileResponse(full_path)
