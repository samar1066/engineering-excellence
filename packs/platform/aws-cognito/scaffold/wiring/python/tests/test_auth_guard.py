"""Unit tests for the Cognito access-token guard, run against a mocked JWKS and locally minted tokens.

The pool's real JWKS endpoint is never called. Each test generates an RSA keypair, publishes the
public half as the pool's one signing key, mints an access token signed with the private half, and
drives the guard's verification directly. This proves the guard accepts a well formed access token
and rejects every way one can be wrong: another client, an id token, another issuer, an expired
token, and a token signed by a key the pool never published.
"""

import base64
import time
from typing import Any

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from jose import jwt

from app.api import auth
from app.core.config import settings

KID = "test-key-1"
REGION = "us-east-1"
POOL_ID = "us-east-1_examplepool"
CLIENT_ID = "example-client-id"


def _b64uint(value: int) -> str:
    length = (value.bit_length() + 7) // 8
    return base64.urlsafe_b64encode(value.to_bytes(length, "big")).rstrip(b"=").decode()


def _pem(private_key: rsa.RSAPrivateKey) -> str:
    return private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()


@pytest.fixture(autouse=True)
def configured_pool(monkeypatch: pytest.MonkeyPatch) -> str:
    # Point the guard at the fixture pool, then hand it a private key to sign with and its matching
    # public JWK to verify against, with the JWKS cache preloaded so no network fetch is attempted.
    monkeypatch.setattr(settings, "aws_region", REGION)
    monkeypatch.setattr(settings, "cognito_user_pool_id", POOL_ID)
    monkeypatch.setattr(settings, "cognito_client_id", CLIENT_ID)

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    numbers = private_key.public_key().public_numbers()
    jwk = {
        "kty": "RSA",
        "kid": KID,
        "use": "sig",
        "alg": "RS256",
        "n": _b64uint(numbers.n),
        "e": _b64uint(numbers.e),
    }

    fresh = auth._JwksCache()
    fresh._keys = {KID: jwk}
    monkeypatch.setattr(auth, "_jwks", fresh)

    return _pem(private_key)


def _issuer() -> str:
    return f"https://cognito-idp.{REGION}.amazonaws.com/{POOL_ID}"


def _make_token(private_pem: str, **overrides: Any) -> str:
    claims: dict[str, Any] = {
        "sub": "user-123",
        "token_use": "access",
        "client_id": CLIENT_ID,
        "iss": _issuer(),
        "username": "ada",
        "scope": "aws.cognito.signin.user.admin",
        "cognito:groups": ["engineers"],
        "exp": int(time.time()) + 3600,
        "iat": int(time.time()),
    }
    claims.update(overrides)
    return jwt.encode(claims, private_pem, algorithm="RS256", headers={"kid": KID})


async def test_accepts_a_valid_access_token(configured_pool: str) -> None:
    user = await auth._verify_access_token(_make_token(configured_pool))
    assert user.sub == "user-123"
    assert user.username == "ada"
    assert user.client_id == CLIENT_ID
    assert user.groups == ["engineers"]


async def test_rejects_a_token_issued_for_another_client(configured_pool: str) -> None:
    token = _make_token(configured_pool, client_id="someone-elses-client")
    with pytest.raises(HTTPException) as caught:
        await auth._verify_access_token(token)
    assert caught.value.status_code == 401


async def test_rejects_an_id_token(configured_pool: str) -> None:
    token = _make_token(configured_pool, token_use="id")
    with pytest.raises(HTTPException) as caught:
        await auth._verify_access_token(token)
    assert caught.value.status_code == 401


async def test_rejects_a_token_from_another_issuer(configured_pool: str) -> None:
    token = _make_token(configured_pool, iss="https://example.com/not-our-pool")
    with pytest.raises(HTTPException) as caught:
        await auth._verify_access_token(token)
    assert caught.value.status_code == 401


async def test_rejects_an_expired_token(configured_pool: str) -> None:
    token = _make_token(configured_pool, exp=int(time.time()) - 10)
    with pytest.raises(HTTPException) as caught:
        await auth._verify_access_token(token)
    assert caught.value.status_code == 401


async def test_rejects_a_token_signed_by_an_unpublished_key(configured_pool: str) -> None:
    # Signed with a different private key than the one whose public half the JWKS holds, but carrying
    # the trusted kid, so the signature check is what has to fail.
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    token = _make_token(_pem(other))
    with pytest.raises(HTTPException) as caught:
        await auth._verify_access_token(token)
    assert caught.value.status_code == 401


async def test_missing_bearer_is_unauthorized() -> None:
    guard = auth.require_user(credentials=None)
    with pytest.raises(HTTPException) as caught:
        await guard.__anext__()
    assert caught.value.status_code == 401
