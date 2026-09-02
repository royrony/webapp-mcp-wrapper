"""T054: OAuth 2.1 + PKCE loopback flow for the Python runtime (FR-014, FR-016).

Mirrors runtimes/node/src/auth/oauth-loopback.ts. Built on `authlib` in production; the
PKCE/URL machinery here is stdlib so it is testable without a live IdP.
"""
from __future__ import annotations

import base64
import hashlib
import http.server
import os
import secrets
import threading
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable


@dataclass
class TokenSet:
    access_token: str
    refresh_token: str | None
    expires_at: float


def generate_pkce() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=").decode()
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )
    return verifier, challenge


def build_authorization_url(config: dict, redirect_uri: str, challenge: str, state: str) -> str:
    params = {
        "response_type": "code",
        "client_id": config["clientId"],
        "redirect_uri": redirect_uri,
        "scope": " ".join(config.get("scopes", [])),
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": state,
    }
    return config["authorizationEndpoint"] + "?" + urllib.parse.urlencode(params)


def _default_exchange(config: dict) -> Callable[[str, str, str], TokenSet]:
    def exchange(code: str, verifier: str, redirect_uri: str) -> TokenSet:
        data = urllib.parse.urlencode(
            {
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": config["clientId"],
                "code_verifier": verifier,
            }
        ).encode()
        req = urllib.request.Request(config["tokenEndpoint"], data=data, method="POST")
        with urllib.request.urlopen(req) as resp:  # noqa: S310
            import json

            j = json.loads(resp.read().decode())
        return TokenSet(
            access_token=j["access_token"],
            refresh_token=j.get("refresh_token"),
            expires_at=time.time() + j.get("expires_in", 3600),
        )

    return exchange


def run_loopback_flow(
    config: dict,
    *,
    open_browser: Callable[[str], None] | None = None,
    exchange_code: Callable[[str, str, str], TokenSet] | None = None,
    port: int = 0,
) -> TokenSet:
    verifier, challenge = generate_pkce()
    state = secrets.token_hex(8)
    exchange = exchange_code or _default_exchange(config)
    result: dict[str, TokenSet] = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            qs = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(qs)
            code = params.get("code", [None])[0]
            returned_state = params.get("state", [None])[0]
            if not code or returned_state != state:
                self.send_response(400)
                self.end_headers()
                return
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"<h1>Authorized. You may close this window.</h1>")
            redirect_uri = f"http://127.0.0.1:{self.server.server_address[1]}/callback"
            result["tokens"] = exchange(code, verifier, redirect_uri)

        def log_message(self, *_args: object) -> None:  # silence
            pass

    server = http.server.HTTPServer(("127.0.0.1", port), Handler)
    bound_port = server.server_address[1]
    redirect_uri = f"http://127.0.0.1:{bound_port}/callback"
    auth_url = build_authorization_url(config, redirect_uri, challenge, state)
    (open_browser or (lambda u: print(f"Open this URL to authorize:\n{u}")))(auth_url)

    thread = threading.Thread(target=server.handle_request)
    thread.start()
    thread.join(timeout=120)
    server.server_close()
    return result["tokens"]
