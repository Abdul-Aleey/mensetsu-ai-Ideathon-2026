"""Perxona Connect API — login + token caching, mirroring the pattern in
Perxona's own perxona-connect-kit sample (getToken()/authedCall()).

Powers the Presenter SDK (<sv-presenter> + present()): unlike the <sv-agent>
widget's domain-scoped apiKey, Connect uses a real email/password account
exchanged for a short-lived bearer token, validated and re-minted here so
the frontend never needs to know the password.
"""

import requests

from ..config import settings

_cached_token: str | None = None


def _login() -> str:
    resp = requests.post(
        f"{settings.perxona_api_base_url}/api/v1/connect/auth/login",
        json={"email": settings.perxona_connect_email, "password": settings.perxona_connect_password},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def _is_valid(token: str) -> bool:
    try:
        resp = requests.get(
            f"{settings.perxona_api_base_url}/api/v1/connect/voices",
            headers={"Authorization": f"Bearer {token}"},
            params={"size": 1},
            timeout=10,
        )
        return resp.status_code < 400
    except requests.RequestException:
        return False


def get_connect_token() -> str | None:
    """Returns a validated Connect bearer token, logging in on first use and
    transparently re-logging in if the cached token was rejected. Returns
    None if Connect credentials aren't configured (reflected in
    /api/status's perxona_configured)."""
    global _cached_token
    if not settings.perxona_connect_email or not settings.perxona_connect_password:
        return None
    if _cached_token and _is_valid(_cached_token):
        return _cached_token
    _cached_token = _login()
    return _cached_token
