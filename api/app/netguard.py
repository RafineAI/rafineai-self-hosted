"""Shared SSRF guard for outbound HTTP made on behalf of users.

Any feature that fetches a user-supplied URL server-side (API Client tool,
web-read context) must call `guard_url` first so the request cannot be steered
at internal infrastructure — loopback, private, link-local and reserved ranges
(incl. the cloud metadata endpoint 169.254.169.254) are rejected.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

from fastapi import HTTPException, status


def guard_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "yalnızca http/https desteklenir")
    host = parsed.hostname
    if not host:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "geçersiz URL")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "host çözümlenemedi")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_reserved:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "iç ağ / özel IP adreslerine istek engellendi (SSRF koruması)",
            )
