"""Asserts the Python runtime's reliability constants match the shared spec (Principle VI)."""
from wrapper_runtime import reliability as r


def test_retry_gating():
    assert r.is_retryable(idempotent=True, status=503) is True
    assert r.is_retryable(idempotent=True, status=429) is True
    assert r.is_retryable(idempotent=True, is_timeout=True) is True
    assert r.is_retryable(idempotent=True, status=404) is False
    assert r.is_retryable(idempotent=False, status=503) is False
    assert r.is_retryable(idempotent=False, is_timeout=True) is False


def test_backoff_schedule():
    assert r.backoff_schedule() == [200, 400]


def test_max_attempts_is_three():
    assert r.MAX_ATTEMPTS == 3


def test_redact():
    assert "<redacted>" in r.redact_for_log("Authorization: Bearer abc.def.ghi")
