"""Application settings loaded from environment variables."""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Core
    database_url: str = "postgres://rafine:rafine@localhost:5432/rafineai"
    rafine_master_key: str = "dev-master-key-change-me-please-32b"
    jwt_secret: str = "dev-jwt-secret-change-me-please-32b"
    jwt_access_ttl_min: int = 60
    jwt_refresh_ttl_days: int = 14

    # Default owner (seeded on first boot)
    owner_email: str = "owner@rafine.local"
    owner_password: str = "change-me-owner-password"

    # Gateway location (api proxies chat traffic here)
    gateway_url: str = "http://gateway:8080"

    # Public URL (CORS / OAuth redirects)
    rafine_public_url: str = "http://localhost"

    # Path to SQL migrations (relative to repo root inside the container)
    migrations_dir: str = "db/migrations"

    # Directory for chat/message uploaded files (served via nginx /uploads/).
    uploads_dir: str = "/data/uploads"
    # Local document-storage root (Belgelerim / RAG corpus), mounted volume.
    storage_dir: str = "/data/storage"
    # Maximum upload size in bytes (default 25 MB, matches nginx client_max_body_size).
    max_upload_bytes: int = 25 * 1024 * 1024


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
