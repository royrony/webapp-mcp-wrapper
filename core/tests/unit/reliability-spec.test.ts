import { describe, it, expect } from "vitest";
import {
  isRetryable,
  backoffSchedule,
  RETRY_CONFORMANCE_VECTORS,
  EXPECTED_BACKOFF_SCHEDULE_MS,
} from "../../src/runtime-spec/reliability-spec.js";

describe("reliability-spec", () => {
  it("only retries transient failures on idempotent calls", () => {
    for (const v of RETRY_CONFORMANCE_VECTORS) {
      expect(isRetryable(v.input)).toBe(v.expectedRetryable);
    }
  });

  it("never retries non-idempotent (mutating) calls", () => {
    expect(isRetryable({ idempotent: false, status: 503 })).toBe(false);
    expect(isRetryable({ idempotent: false, isTimeout: true })).toBe(false);
  });

  it("produces an exponential pre-jitter schedule of maxAttempts-1 waits", () => {
    expect(backoffSchedule()).toEqual([200, 400]);
    expect(EXPECTED_BACKOFF_SCHEDULE_MS).toEqual([200, 400]);
  });
});
