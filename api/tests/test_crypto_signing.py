"""Crypto and signing unit tests (no DB required)."""
from app import crypto, signing


def test_crypto_roundtrip():
    mk = "master-key-for-tests"
    secret = "sk-proj-abc123"
    blob = crypto.encrypt(mk, secret)
    assert crypto.decrypt(mk, blob) == secret


def test_crypto_wrong_key_fails():
    blob = crypto.encrypt("key-a", "hello")
    try:
        crypto.decrypt("key-b", blob)
        assert False, "expected failure"
    except Exception:
        pass


def test_crypto_nonce_is_random():
    a = crypto.encrypt("k", "same")
    b = crypto.encrypt("k", "same")
    assert a != b


def test_signing_format():
    tok = signing.sign("mk", user_id="u1", key_id="k1", provider_id="p1", issued_at=1700000000)
    assert tok.startswith("rk_")
    assert tok.count(".") == 1


def test_signing_deterministic_with_fixed_iat():
    a = signing.sign("mk", "u1", "k1", "p1", issued_at=1700000000)
    b = signing.sign("mk", "u1", "k1", "p1", issued_at=1700000000)
    assert a == b
