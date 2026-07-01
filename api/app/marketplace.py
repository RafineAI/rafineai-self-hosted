"""Marketplace catalog — the set of installable integrations.

The catalog is code-defined (no DB). Each app declares config fields; fields
marked secret are encrypted at rest and never returned to the client. Apps with
no config fields are pure tools (no credentials) and are simply enabled/disabled.
"""
from __future__ import annotations

from typing import Any

CATALOG: list[dict[str, Any]] = [
    {
        "slug": "github",
        "name": "GitHub",
        "category": "Geliştirici",
        "icon": "🐙",
        "description": "Repolarınızı listeleyin, dosya ağacını gezin ve içerikleri "
                       "okuyup sohbete bağlam olarak ekleyin.",
        "config_fields": [
            {"key": "token", "label": "Personal Access Token", "secret": True,
             "placeholder": "ghp_..."},
            {"key": "api_base", "label": "API Base (GitHub Enterprise için)",
             "secret": False, "placeholder": "https://api.github.com", "optional": True},
        ],
    },
    {
        "slug": "slack",
        "name": "Slack",
        "category": "İletişim",
        "icon": "💬",
        "description": "Kanalları takip edin; Slack mesajlaşmasını panel içinden "
                       "görüntüleyin ve yanıtlayın.",
        "config_fields": [
            {"key": "bot_token", "label": "Bot User OAuth Token", "secret": True,
             "placeholder": "xoxb-..."},
        ],
    },
    {
        "slug": "sentry",
        "name": "Sentry",
        "category": "Gözlemlenebilirlik",
        "icon": "🛡️",
        "description": "Projelerinizdeki hataları (issues) listeleyin ve "
                       "ayrıntılarını LLM'e açıklatın.",
        "config_fields": [
            {"key": "token", "label": "Auth Token", "secret": True,
             "placeholder": "sntrys_..."},
            {"key": "org_slug", "label": "Organizasyon slug", "secret": False,
             "placeholder": "my-org"},
            {"key": "api_base", "label": "API Base", "secret": False,
             "placeholder": "https://sentry.io", "optional": True},
        ],
    },
    {
        "slug": "api_client",
        "name": "API Client",
        "category": "Geliştirici",
        "icon": "🛰️",
        "description": "Postman benzeri istek oluşturucu: istek gönderin, yanıtı "
                       "inceleyin, hatayı LLM'e sorun. OpenAPI/Swagger içe aktarın.",
        "config_fields": [],
    },
    {
        "slug": "swagger",
        "name": "Swagger / OpenAPI",
        "category": "Geliştirici",
        "icon": "📘",
        "description": "OpenAPI tanımınızı görüntüleyin ve endpoint'leri API "
                       "Client'a tek tıkla aktarın.",
        "config_fields": [],
    },
    {
        "slug": "finetune",
        "name": "Fine-tuning",
        "category": "Model",
        "icon": "🎯",
        "description": "Yüklediğiniz eğitim dosyasıyla OpenAI üzerinde fine-tune "
                       "işi başlatın ve durumunu takip edin.",
        "config_fields": [],
    },
]

BY_SLUG = {a["slug"]: a for a in CATALOG}


def public_app(app: dict[str, Any], installed: bool, enabled: bool) -> dict[str, Any]:
    """Catalog entry shaped for the client (never includes secret values)."""
    return {
        "slug": app["slug"],
        "name": app["name"],
        "category": app["category"],
        "icon": app["icon"],
        "description": app["description"],
        "config_fields": app["config_fields"],
        "needs_config": any(not f.get("optional") for f in app["config_fields"]),
        "installed": installed,
        "enabled": enabled,
    }
