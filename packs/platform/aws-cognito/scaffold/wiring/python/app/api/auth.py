"""Cognito access-token authentication guard for the FastAPI backend.

`require_user` is a FastAPI dependency that authenticates a request by its bearer token, validated
as an Amazon Cognito user pool ACCESS token. The RS256 signature is checked against the pool's
published JWKS, and the issuer, the expiry, the token_use, and the client_id are all verified before
any claim is trusted; only then is a small typed `AuthenticatedUser` yielded, and any failure raises
a 401. Region, pool id, and client id come from `app.core.config`, which reads them from the
environment, so the guard is configured by the same COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID /
AWS_REGION the infrastructure hands the service.

This module drops into the backend at `app/api/auth.py` unchanged. It is wired as a router-level
dependency so the notes routes run only for an authenticated caller while the health route stays
public; a route that needs the caller re-declares `Depends(require_user)` and receives the same
`AuthenticatedUser`.
"""

import json
import urllib.request
from collections.abc import AsyncIterator
from typing import Any

import anyio
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import jwt  # type: ignore[import-untyped]
from jose.exceptions import JWTError  # type: ignore[import-untyped]
from pydantic import BaseModel

from app.core.config import settings

# The Cognito access token signing algorithm. A user pool signs its tokens with RS256, and pinning
# the algorithm here refuses a token that asks to be verified under a weaker or absent one.
_ALGORITHMS = ["RS256"]
_JWKS_TIMEOUT_SECONDS = 5


class AuthenticatedUser(BaseModel):
    """The verified subset of a Cognito access token the application trusts downstream.

    Only fields the backend actually reads are lifted out of the raw claims: the subject that
    identifies the caller, and a few attributes a route may want. Everything the token carries is
    still there in Cognito; this is the shape the application code speaks.
    """

    sub: str
    username: str | None = None
    client_id: str | None = None
    scope: str | None = None
    groups: list[str] = []


def _issuer() -> str:
    region = settings.aws_region
    pool_id = settings.cognito_user_pool_id
    return f"https://cognito-idp.{region}.amazonaws.com/{pool_id}"


def _jwks_url() -> str:
    return f"{_issuer()}/.well-known/jwks.json"


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


class _JwksCache:
    """Caches the pool's signing keys by key id, refetching only when an unseen kid arrives.

    A user pool rotates its signing keys rarely and publishes every currently valid key at its JWKS
    endpoint, so the common path is a lookup in this dict with no network call. A token whose kid is
    absent triggers exactly one refetch, which also picks up a freshly rotated key.
    """

    def __init__(self) -> None:
        self._keys: dict[str, dict[str, Any]] = {}

    def _fetch(self) -> dict[str, dict[str, Any]]:
        # The URL is always the pool's https JWKS endpoint built from configuration, never caller
        # input, so the audited-scheme warning does not apply.
        url = _jwks_url()
        with urllib.request.urlopen(url, timeout=_JWKS_TIMEOUT_SECONDS) as response:  # noqa: S310
            document = json.loads(response.read().decode())
        return {key["kid"]: key for key in document.get("keys", [])}

    async def key_for(self, kid: str) -> dict[str, Any]:
        if kid not in self._keys:
            # The fetch is blocking urllib, so it runs off the event loop; it happens at most once
            # per key id, effectively once at startup, because the result is cached.
            self._keys = await anyio.to_thread.run_sync(self._fetch)
        key = self._keys.get(kid)
        if key is None:
            raise _unauthorized("token signed by an unknown key")
        return key


_jwks = _JwksCache()
_bearer = HTTPBearer(auto_error=False)


async def _verify_access_token(token: str) -> AuthenticatedUser:
    try:
        header = jwt.get_unverified_header(token)
    except JWTError as error:
        raise _unauthorized("malformed authentication token") from error
    kid = header.get("kid")
    if not kid:
        raise _unauthorized("authentication token carries no key id")

    key = await _jwks.key_for(kid)
    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=_ALGORITHMS,
            issuer=_issuer(),
            # A Cognito access token carries `client_id`, not `aud`, so audience verification is
            # turned off here and the client is checked explicitly against the configured one below.
            options={"verify_aud": False, "require_exp": True},
        )
    except JWTError as error:
        raise _unauthorized("authentication token failed verification") from error

    if claims.get("token_use") != "access":
        raise _unauthorized("authentication token is not an access token")
    if claims.get("client_id") != settings.cognito_client_id:
        raise _unauthorized("authentication token was issued for another client")

    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub:
        raise _unauthorized("authentication token carries no subject")

    raw_groups = claims.get("cognito:groups")
    groups = [str(group) for group in raw_groups] if isinstance(raw_groups, list) else []
    return AuthenticatedUser(
        sub=sub,
        username=claims.get("username"),
        client_id=claims.get("client_id"),
        scope=claims.get("scope"),
        groups=groups,
    )


async def require_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> AsyncIterator[AuthenticatedUser]:
    """Authenticate the request and yield the caller, or raise 401.

    Wired as a router-level dependency, so every route it guards runs only after a token has been
    verified. The API test suite overrides this dependency with a fake authenticated user, which is
    what lets the guarded routes stay green with no real Cognito in the loop.
    """

    if credentials is None or not credentials.credentials:
        raise _unauthorized("missing bearer token")
    yield await _verify_access_token(credentials.credentials)
