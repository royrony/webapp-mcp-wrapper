"""Python runtime reliability implementation of the shared spec (T023).

Constants MUST match core/src/runtime-spec/reliability-spec.ts and the Node/Java
runtimes; the cross-language conformance suite (T068) asserts this.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

MAX_ATTEMPTS = 3
BASE_DELAY_MS = 200
FACTOR = 2
JITTER_FRACTION = 0.5
TRANSIENT_STATUSES = [408, 429, 500, 502, 503, 504]

_BEARER_RE = re.compile(r"(bearer\s+)[A-Za-z0-9._-]+", re.IGNORECASE)


def is_retryable(*, idempotent: bool, status: int | None = None, is_timeout: bool = False) -> bool:
    """Retry only transient failures on idempotent calls (never mutating/non-idempotent)."""
    if not idempotent:
        return False
    if is_timeout:
        return True
    if status is None:
        return False
    return status in TRANSIENT_STATUSES


def base_delay_for_attempt(attempt: int) -> float:
    return BASE_DELAY_MS * (FACTOR ** attempt)


def backoff_schedule() -> list[float]:
    return [base_delay_for_attempt(a) for a in range(MAX_ATTEMPTS - 1)]


def redact_for_log(value: str) -> str:
    return _BEARER_RE.sub(r"\1<redacted>", value)


@dataclass
class InvokeResult:
    ok: bool
    attempts: int
    status: int | None = None
    body: object = None
    error: str | None = None
