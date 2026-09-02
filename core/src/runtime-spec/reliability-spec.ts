// T023: The reliability spec (FR-017; research.md #5, #10).
//
// This is the single source of truth for retry/backoff and structured-logging
// behavior that ALL THREE language runtimes must match. It defines:
//   1. the retry policy (attempts, gating, backoff formula),
//   2. the structured-log record shape, and
//   3. shared test vectors the cross-language conformance suite (T068) asserts against,
// so parity is verified rather than trusted (Constitution Principle VI).

export interface RetrySpec {
  /** Total attempts including the first (contract fixes this at 3). */
  maxAttempts: number;
  /** Base backoff in ms before jitter. */
  baseDelayMs: number;
  /** Multiplier applied per attempt (exponential). */
  factor: number;
  /** Max +/- jitter fraction applied to each delay (0.0–1.0). */
  jitterFraction: number;
  /** HTTP status codes considered transient (retryable). */
  transientStatuses: number[];
}

export const RETRY_SPEC: RetrySpec = {
  maxAttempts: 3,
  baseDelayMs: 200,
  factor: 2,
  jitterFraction: 0.5,
  transientStatuses: [408, 429, 500, 502, 503, 504],
};

/** A failure is retryable only if it is transient AND the tool is idempotent/read-only.
 * This gate prevents duplicating side effects on non-idempotent mutating calls. */
export function isRetryable(params: {
  idempotent: boolean;
  status?: number;
  isTimeout?: boolean;
}): boolean {
  if (!params.idempotent) return false;
  if (params.isTimeout) return true;
  if (params.status == null) return false;
  return RETRY_SPEC.transientStatuses.includes(params.status);
}

/** Deterministic base delay (pre-jitter) for a given attempt index (0-based).
 * Runtimes add jitter at call time; the *base* schedule below is what the
 * conformance suite compares across languages. */
export function baseDelayForAttempt(attempt: number, spec: RetrySpec = RETRY_SPEC): number {
  return spec.baseDelayMs * Math.pow(spec.factor, attempt);
}

/** The full pre-jitter backoff schedule for a run that exhausts all retries. */
export function backoffSchedule(spec: RetrySpec = RETRY_SPEC): number[] {
  // maxAttempts total attempts => (maxAttempts - 1) waits between them.
  const waits: number[] = [];
  for (let attempt = 0; attempt < spec.maxAttempts - 1; attempt++) {
    waits.push(baseDelayForAttempt(attempt, spec));
  }
  return waits;
}

/** The structured log record every runtime MUST emit per tool invocation.
 * Field names and types are fixed here so log shape is identical across languages. */
export interface ToolInvocationLogRecord {
  /** ISO-8601 timestamp. */
  ts: string;
  level: "info" | "warn" | "error";
  event: "tool_invocation";
  toolName: string;
  /** How many attempts were made (1 when it succeeds first try). */
  attempts: number;
  outcome: "success" | "failure";
  /** Total wall time in ms. */
  durationMs: number;
  /** Present only on failure; never contains tokens/secrets. */
  error?: string;
}

/** Redact any token-like material before logging (defense in depth for Principle V). */
export function redactForLog(value: string): string {
  return value.replace(/(bearer\s+)[A-Za-z0-9._-]+/gi, "$1<redacted>");
}

/** Shared conformance vectors: given (idempotent,status/timeout), expect retryable? */
export const RETRY_CONFORMANCE_VECTORS: Array<{
  name: string;
  input: { idempotent: boolean; status?: number; isTimeout?: boolean };
  expectedRetryable: boolean;
}> = [
  { name: "read-only 503", input: { idempotent: true, status: 503 }, expectedRetryable: true },
  { name: "read-only 429", input: { idempotent: true, status: 429 }, expectedRetryable: true },
  { name: "read-only timeout", input: { idempotent: true, isTimeout: true }, expectedRetryable: true },
  { name: "read-only 404", input: { idempotent: true, status: 404 }, expectedRetryable: false },
  { name: "mutating 503", input: { idempotent: false, status: 503 }, expectedRetryable: false },
  { name: "mutating timeout", input: { idempotent: false, isTimeout: true }, expectedRetryable: false },
];

/** Expected pre-jitter schedule the conformance suite checks in every language. */
export const EXPECTED_BACKOFF_SCHEDULE_MS = backoffSchedule();
