"""Password hashing, generation, and JWT session tokens."""
from __future__ import annotations

import datetime as dt
import secrets

import bcrypt
import jwt

ALGO = "HS256"

# Unambiguous alphabet (no O/0/I/l) for human-friendly temp passwords.
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"


def generate_password(length: int = 14) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def create_access_token(secret: str, user_id: str, role: str, ttl_min: int) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "type": "access",
        "exp": _now() + dt.timedelta(minutes=ttl_min),
        "iat": _now(),
    }
    return jwt.encode(payload, secret, algorithm=ALGO)


def create_refresh_token(secret: str, user_id: str, ttl_days: int) -> str:
    payload = {
        "sub": user_id,
        "type": "refresh",
        "exp": _now() + dt.timedelta(days=ttl_days),
        "iat": _now(),
    }
    return jwt.encode(payload, secret, algorithm=ALGO)


def decode_token(secret: str, token: str) -> dict:
    """Decode and validate a JWT. Raises jwt.PyJWTError on failure."""
    return jwt.decode(token, secret, algorithms=[ALGO])
