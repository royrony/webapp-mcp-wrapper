"""T057: OAuth 2.1 + PKCE hosted-redirect flow for the Python runtime (FR-014, FR-016).

Mirrors runtimes/node/src/auth/oauth-hosted.ts.
"""
from __future__ import annotations

import json
import secrets
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass

from .oauth_loopback import TokenSet, build_authorization_url, generate_pkce


@dataclass
class HostedFlowState:
    authorization_url: str
    verifier: str
    state: str
    redirect_uri: str


def begin_hosted_flow(config: dict) -> HostedFlowState:
    if config.get("redirectMode") != "hosted" or not config.get("hostedRedirectUri"):
        raise ValueError("hosted flow requires redirectMode 'hosted' and a hostedRedirectUri")
    verifier, challenge = generate_pkce()
    state = secrets.token_hex(8)
    url = build_authorization_url(config, config["hostedRedirectUri"], challenge, state)
    return HostedFlowState(url, verifier, state, config["hostedRedirectUri"])


def complete_hosted_flow(config: dict, flow: HostedFlowState, code: str, returned_state: str) -> TokenSet:
    if returned_state != flow.state:
        raise ValueError("state mismatch")
    data = urllib.parse.urlencode(
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": flow.redirect_uri,
            "client_id": config["clientId"],
            "code_verifier": flow.verifier,
        }
    ).encode()
    req = urllib.request.Request(config["tokenEndpoint"], data=data, method="POST")
    with urllib.request.urlopen(req) as resp:  # noqa: S310
        j = json.loads(resp.read().decode())
    return TokenSet(
        access_token=j["access_token"],
        refresh_token=j.get("refresh_token"),
        expires_at=time.time() + j.get("expires_in", 3600),
    )
