"""T062 + T067: OAuth-authenticated dispatch wiring + api-key fallback for the Python runtime.

Mirrors runtimes/node/src/auth/auth-provider.ts. Produces the token supplier the server attaches
to every tool call.
"""
from __future__ import annotations

import os
import time
from typing import Callable

from .oauth_loopback import run_loopback_flow
from .token_store import TokenStore, create_token_store


def create_auth_provider(
    config: dict,
    *,
    mode: str,
    session: str,
    api_key: str | None = None,
    store: TokenStore | None = None,
) -> Callable[[], str | None]:
    """Return a callable that yields the current bearer token (or None)."""
    fallback = config.get("fallback") or {}
    if fallback.get("mode") == "api-key" and api_key:
        return lambda: api_key

    token_store = store or create_token_store(mode)

    def get_token() -> str | None:
        existing = token_store.load(session)
        now = time.time()
        if existing and existing.expires_at > now + 30:
            return existing.access_token
        if mode == "stdio":
            tokens = run_loopback_flow(config)
            token_store.save(session, tokens)
            return tokens.access_token
        return existing.access_token if existing else None

    return get_token


def api_key_from_env() -> str | None:
    return os.environ.get("WRAPPER_API_KEY")
