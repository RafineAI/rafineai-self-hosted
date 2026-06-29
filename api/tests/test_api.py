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


async def test_provider_smart_routing_fields(client):
    owner_token = await login(client, *OWNER)
    r = await client.post("/api/providers", headers=auth(owner_token), json={
        "name": "Routed", "type": "openai", "auth_mode": "api_key",
        "api_key": "sk", "default_model": "gpt-4o",
        "light_model": "gpt-4o-mini", "heavy_model": "gpt-4o",
        "route_threshold_tokens": 500,
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["light_model"] == "gpt-4o-mini"
    assert body["heavy_model"] == "gpt-4o"
    assert body["route_threshold_tokens"] == 500


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


async def test_create_user_without_password_generates_one(client):
    owner_token = await login(client, *OWNER)
    r = await client.post("/api/users", headers=auth(owner_token),
                          json={"email": "gen@x.com", "role": "user"})
    assert r.status_code == 201, r.text
    body = r.json()
    # System-generated password is returned and a change is required.
    assert body["generated_password"] and len(body["generated_password"]) >= 12
    assert body["must_change_password"] is True

    # The generated password actually works for login.
    await login(client, "gen@x.com", body["generated_password"])


async def test_create_user_with_password_no_generated_and_no_forced_change(client):
    owner_token = await login(client, *OWNER)
    r = await client.post("/api/users", headers=auth(owner_token),
                          json={"email": "set@x.com", "password": "adminset123", "role": "user"})
    assert r.status_code == 201
    body = r.json()
    assert body["generated_password"] is None
    assert body["must_change_password"] is False


async def test_change_password_flow_clears_force_flag(client):
    owner_token = await login(client, *OWNER)
    r = await client.post("/api/users", headers=auth(owner_token),
                          json={"email": "flow@x.com", "role": "user"})
    temp = r.json()["generated_password"]

    user_token = await login(client, "flow@x.com", temp)
    # Wrong current password is rejected.
    r = await client.post("/api/auth/change-password", headers=auth(user_token),
                          json={"current_password": "nope", "new_password": "brandnew123"})
    assert r.status_code == 400

    # Correct change succeeds and clears the must-change flag.
    r = await client.post("/api/auth/change-password", headers=auth(user_token),
                          json={"current_password": temp, "new_password": "brandnew123"})
    assert r.status_code == 204

    me = await client.get("/api/auth/me", headers=auth(user_token))
    assert me.json()["must_change_password"] is False

    # New password works; old one no longer does.
    await login(client, "flow@x.com", "brandnew123")
    r = await client.post("/api/auth/login", json={"email": "flow@x.com", "password": temp})
    assert r.status_code == 401


async def test_chat_stream_persists_assembled_message(client, monkeypatch):
    owner_token = await login(client, *OWNER)
    r = await client.post("/api/providers", headers=auth(owner_token), json={
        "name": "OpenAI", "type": "openai", "auth_mode": "api_key",
        "api_key": "sk", "default_model": "gpt-4o",
    })
    provider_id = r.json()["id"]
    r = await client.post("/api/conversations", headers=auth(owner_token),
                          json={"provider_id": provider_id, "title": "S"})
    convo_id = r.json()["id"]

    import app.routers.conversations as conv_mod

    class FakeStreamResp:
        status_code = 200
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def aiter_lines(self):
            for line in [
                'data: {"choices":[{"delta":{"role":"assistant"}}]}',
                'data: {"choices":[{"delta":{"content":"Hel"}}]}',
                'data: {"choices":[{"delta":{"content":"lo"}}]}',
                'data: {"choices":[],"usage":{"completion_tokens":2}}',
                'data: [DONE]',
            ]:
                yield line

    class FakeStreamClient:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        def stream(self, *a, **k): return FakeStreamResp()

    monkeypatch.setattr(conv_mod.httpx, "AsyncClient", FakeStreamClient)

    body = ""
    async with client.stream("POST", f"/api/conversations/{convo_id}/chat/stream",
                             headers=auth(owner_token), json={"content": "hi"}) as resp:
        assert resp.status_code == 200
        async for line in resp.aiter_lines():
            body += line
    assert "Hel" in body and "lo" in body and "[DONE]" in body

    msgs = (await client.get(f"/api/conversations/{convo_id}/messages",
                             headers=auth(owner_token))).json()
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[1]["content"] == "Hello"
    assert msgs[1]["tokens"] == 2


async def test_user_rate_limit_fields(client):
    owner_token = await login(client, *OWNER)
    r = await client.post("/api/users", headers=auth(owner_token), json={
        "email": "limited@x.com", "role": "user",
        "rate_limit_rpm": 30, "daily_token_quota": 100000,
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["rate_limit_rpm"] == 30
    assert body["daily_token_quota"] == 100000

    # Update clears/changes the limit.
    r = await client.patch(f"/api/users/{body['id']}", headers=auth(owner_token),
                           json={"rate_limit_rpm": 0})
    assert r.status_code == 200
    assert r.json()["rate_limit_rpm"] == 0


async def test_policy_rule_crud(client):
    owner_token = await login(client, *OWNER)
    # builtins are visible
    r = await client.get("/api/policy/builtins", headers=auth(owner_token))
    assert r.status_code == 200 and len(r.json()) > 5

    r = await client.post("/api/policy/rules", headers=auth(owner_token), json={
        "name": "internal_codename", "category": "custom", "kind": "keyword",
        "pattern": "ProjeAtlas", "action": "mask", "severity": "high",
    })
    assert r.status_code == 201, r.text
    rule_id = r.json()["id"]

    # duplicate name -> 409
    r = await client.post("/api/policy/rules", headers=auth(owner_token), json={
        "name": "internal_codename", "kind": "keyword", "pattern": "x", "action": "flag",
    })
    assert r.status_code == 409

    # disable it
    r = await client.patch(f"/api/policy/rules/{rule_id}", headers=auth(owner_token),
                           json={"enabled": False})
    assert r.status_code == 200 and r.json()["enabled"] is False

    # non-admin cannot manage rules
    await client.post("/api/users", headers=auth(owner_token),
                      json={"email": "pol@x.com", "password": "password123", "role": "user"})
    user_token = await login(client, "pol@x.com", "password123")
    r = await client.get("/api/policy/rules", headers=auth(user_token))
    assert r.status_code == 403

    r = await client.delete(f"/api/policy/rules/{rule_id}", headers=auth(owner_token))
    assert r.status_code == 204


async def test_alerts_list_and_resolve(client):
    owner_token = await login(client, *OWNER)
    # Seed an alert directly (the gateway is what writes these in production).
    from app import db as appdb
    await appdb.pool().execute(
        "INSERT INTO alerts (rule_name, category, action, severity, snippet) "
        "VALUES ('secret_openai_key', 'secret', 'mask', 'high', 'key [MASKED] here')"
    )
    r = await client.get("/api/alerts", headers=auth(owner_token))
    assert r.status_code == 200 and len(r.json()) == 1
    alert_id = r.json()[0]["id"]
    assert "[MASKED]" in r.json()[0]["snippet"]

    r = await client.post(f"/api/alerts/{alert_id}/resolve", headers=auth(owner_token))
    assert r.status_code == 204

    r = await client.get("/api/alerts?resolved=false", headers=auth(owner_token))
    assert len(r.json()) == 0


async def test_audit_requires_admin(client):
    owner_token = await login(client, *OWNER)
    await client.post("/api/users", headers=auth(owner_token),
                      json={"email": "u2@x.com", "password": "password123", "role": "user"})
    user_token = await login(client, "u2@x.com", "password123")
    r = await client.get("/api/audit", headers=auth(user_token))
    assert r.status_code == 403
    r = await client.get("/api/audit", headers=auth(owner_token))
    assert r.status_code == 200
