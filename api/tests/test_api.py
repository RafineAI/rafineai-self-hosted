"""End-to-end API tests against a real Postgres, with the gateway mocked."""
import pytest

from tests.conftest import auth, login

OWNER = ("owner@rafine.local", "owner-password-123")

pytestmark = pytest.mark.asyncio


async def test_health(client):
    resp = await client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


async def test_owner_login_and_me(client):
    token = await login(client, *OWNER)
    me = await client.get("/api/auth/me", headers=auth(token))
    assert me.status_code == 200
    assert me.json()["role"] == "owner"


async def test_login_rejects_bad_password(client):
    resp = await client.post("/api/auth/login", json={"email": OWNER[0], "password": "wrong"})
    assert resp.status_code == 401


async def test_user_crud_and_role_enforcement(client):
    owner_token = await login(client, *OWNER)

    # Owner creates an admin and a user.
    r = await client.post("/api/users", headers=auth(owner_token),
                          json={"email": "admin@x.com", "password": "password123", "role": "admin"})
    assert r.status_code == 201, r.text
    r = await client.post("/api/users", headers=auth(owner_token),
                          json={"email": "user@x.com", "password": "password123", "role": "user"})
    assert r.status_code == 201
    user_id = r.json()["id"]

    # Duplicate email -> 409.
    r = await client.post("/api/users", headers=auth(owner_token),
                          json={"email": "user@x.com", "password": "password123", "role": "user"})
    assert r.status_code == 409

    # A plain user cannot list users.
    user_token = await login(client, "user@x.com", "password123")
    r = await client.get("/api/users", headers=auth(user_token))
    assert r.status_code == 403

    # Owner deactivates the user.
    r = await client.patch(f"/api/users/{user_id}", headers=auth(owner_token),
                           json={"is_active": False})
    assert r.status_code == 200
    # Deactivated user can no longer log in.
    r = await client.post("/api/auth/login", json={"email": "user@x.com", "password": "password123"})
    assert r.status_code == 401


async def test_owner_cannot_be_deleted(client):
    owner_token = await login(client, *OWNER)
    me = await client.get("/api/auth/me", headers=auth(owner_token))
    owner_id = me.json()["id"]
    r = await client.delete(f"/api/users/{owner_id}", headers=auth(owner_token))
    assert r.status_code == 403


async def test_provider_crud_hides_api_key(client):
    owner_token = await login(client, *OWNER)
    r = await client.post("/api/providers", headers=auth(owner_token), json={
        "name": "OpenAI Prod", "type": "openai", "auth_mode": "api_key",
        "api_key": "sk-secret", "default_model": "gpt-4o",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["has_api_key"] is True
    assert "api_key" not in body  # raw key never leaves the server

    # List shows the provider.
    r = await client.get("/api/providers", headers=auth(owner_token))
    assert len(r.json()) == 1


async def test_chat_flow_persists_messages(client, monkeypatch):
    owner_token = await login(client, *OWNER)
    r = await client.post("/api/providers", headers=auth(owner_token), json={
        "name": "OpenAI", "type": "openai", "auth_mode": "api_key",
        "api_key": "sk-secret", "default_model": "gpt-4o",
    })
    provider_id = r.json()["id"]

    r = await client.post("/api/conversations", headers=auth(owner_token),
                          json={"provider_id": provider_id, "title": "T"})
    assert r.status_code == 201, r.text
    convo_id = r.json()["id"]

    # Mock the gateway call made inside the conversations router.
    import app.routers.conversations as conv_mod

    class FakeResp:
        status_code = 200
        def json(self):
            return {"choices": [{"message": {"content": "hello back"}}],
                    "usage": {"completion_tokens": 5}}

    class FakeClient:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k): return FakeResp()

    monkeypatch.setattr(conv_mod.httpx, "AsyncClient", FakeClient)

    r = await client.post(f"/api/conversations/{convo_id}/chat", headers=auth(owner_token),
                          json={"content": "hi"})
    assert r.status_code == 200, r.text
    assert r.json()["message"]["content"] == "hello back"

    # Both user and assistant messages are persisted.
    r = await client.get(f"/api/conversations/{convo_id}/messages", headers=auth(owner_token))
    msgs = r.json()
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[1]["tokens"] == 5


async def test_audit_requires_admin(client):
    owner_token = await login(client, *OWNER)
    await client.post("/api/users", headers=auth(owner_token),
                      json={"email": "u2@x.com", "password": "password123", "role": "user"})
    user_token = await login(client, "u2@x.com", "password123")
    r = await client.get("/api/audit", headers=auth(user_token))
    assert r.status_code == 403
    r = await client.get("/api/audit", headers=auth(owner_token))
    assert r.status_code == 200
