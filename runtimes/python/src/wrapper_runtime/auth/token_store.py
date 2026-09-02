"""T060: RuntimeAuthSession token store for the Python runtime (FR-014; research.md #4).

OS keychain via `keyring` in local/stdio mode; AES-GCM encrypted-file fallback (via
`cryptography`) in hosted mode. Tokens never touch logs/reports (Principle V).
"""
from __future__ import annotations

import base64
import json
import os
from dataclasses import asdict
from typing import Protocol

from .oauth_loopback import TokenSet

SERVICE = "webapp-mcp-wrapper"


class TokenStore(Protocol):
    backend: str

    def save(self, session: str, tokens: TokenSet) -> None: ...
    def load(self, session: str) -> TokenSet | None: ...
    def clear(self, session: str) -> None: ...


class KeyringTokenStore:
    backend = "os-keychain"

    def save(self, session: str, tokens: TokenSet) -> None:
        import keyring

        keyring.set_password(SERVICE, session, json.dumps(asdict(tokens)))

    def load(self, session: str) -> TokenSet | None:
        import keyring

        raw = keyring.get_password(SERVICE, session)
        return TokenSet(**json.loads(raw)) if raw else None

    def clear(self, session: str) -> None:
        import keyring

        try:
            keyring.delete_password(SERVICE, session)
        except keyring.errors.PasswordDeleteError:
            pass


class EncryptedFileTokenStore:
    backend = "encrypted-file"

    def __init__(self, file_path: str, secret: str) -> None:
        if not secret:
            raise ValueError("EncryptedFileTokenStore requires a non-empty secret")
        self.file_path = file_path
        # scrypt-derived 32-byte key; fixed salt since the secret is the entropy source.
        import hashlib

        self.key = hashlib.scrypt(secret.encode(), salt=b"webapp-mcp-wrapper-salt", n=16384, r=8, p=1, dklen=32)

    def _read_all(self) -> dict[str, str]:
        try:
            with open(self.file_path, encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError):
            return {}

    def save(self, session: str, tokens: TokenSet) -> None:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        aes = AESGCM(self.key)
        nonce = os.urandom(12)
        ct = aes.encrypt(nonce, json.dumps(asdict(tokens)).encode(), None)
        blob = base64.b64encode(nonce).decode() + "." + base64.b64encode(ct).decode()
        alld = self._read_all()
        alld[session] = blob
        with open(self.file_path, "w", encoding="utf-8") as f:
            json.dump(alld, f)
        os.chmod(self.file_path, 0o600)

    def load(self, session: str) -> TokenSet | None:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        blob = self._read_all().get(session)
        if not blob:
            return None
        nonce_b64, ct_b64 = blob.split(".")
        aes = AESGCM(self.key)
        pt = aes.decrypt(base64.b64decode(nonce_b64), base64.b64decode(ct_b64), None)
        return TokenSet(**json.loads(pt.decode()))

    def clear(self, session: str) -> None:
        alld = self._read_all()
        alld.pop(session, None)
        with open(self.file_path, "w", encoding="utf-8") as f:
            json.dump(alld, f)


def create_token_store(mode: str, *, file_path: str | None = None, secret: str | None = None) -> TokenStore:
    if mode == "stdio":
        return KeyringTokenStore()
    return EncryptedFileTokenStore(
        file_path or "./.wrapper-tokens.enc",
        secret or os.environ.get("WRAPPER_TOKEN_SECRET", ""),
    )
