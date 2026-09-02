// Node runtime's implementation of the shared reliability spec (T023).
// The constants MUST match core/src/runtime-spec/reliability-spec.ts — the cross-language
// conformance suite (T068) asserts this. Retry is gated on idempotency so non-idempotent
// mutating calls are never retried (Constitution Principle IV).

export const RETRY_SPEC = {
  maxAttempts: 3,
  baseDelayMs: 200,
  factor: 2,
  jitterFraction: 0.5,
  transientStatuses: [408, 429, 500, 502, 503, 504],
};

export function isRetryable(params: { idempotent: boolean; status?: number; isTimeout?: boolean }): boolean {
  if (!params.idempotent) return false;
  if (params.isTimeout) return true;
  if (params.status == null) return false;
  return RETRY_SPEC.transientStatuses.includes(params.status);
}

export function baseDelayForAttempt(attempt: number): number {
  return RETRY_SPEC.baseDelayMs * Math.pow(RETRY_SPEC.factor, attempt);
}

export function backoffSchedule(): number[] {
  const waits: number[] = [];
  for (let attempt = 0; attempt < RETRY_SPEC.maxAttempts - 1; attempt++) {
    waits.push(baseDelayForAttempt(attempt));
  }
  return waits;
}

export interface ToolInvocationLogRecord {
  ts: string;
  level: "info" | "warn" | "error";
  event: "tool_invocation";
  toolName: string;
  attempts: number;
  outcome: "success" | "failure";
  durationMs: number;
  error?: string;
}

export function redactForLog(value: string): string {
  return value.replace(/(bearer\s+)[A-Za-z0-9._-]+/gi, "$1<redacted>");
}

export interface InvokeResult {
  ok: boolean;
  status?: number;
  body?: unknown;
  error?: string;
  attempts: number;
}

/** Invoke a callable with retry/backoff per the spec, emitting one structured log record.
 * `sleep` is injectable so tests don't wait real backoff delays. */
export async function invokeWithReliability(
  toolName: string,
  idempotent: boolean,
  call: (attempt: number) => Promise<{ status: number; body: unknown }>,
  opts: { log?: (r: ToolInvocationLogRecord) => void; sleep?: (ms: number) => Promise<void> } = {},
): Promise<InvokeResult> {
  const log = opts.log ?? ((r) => process.stderr.write(JSON.stringify(r) + "\n"));
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const started = Date.now();
  let attempts = 0;
  let lastError: string | undefined;
  let lastStatus: number | undefined;

  for (let attempt = 0; attempt < RETRY_SPEC.maxAttempts; attempt++) {
    attempts = attempt + 1;
    try {
      const res = await call(attempt);
      lastStatus = res.status;
      if (res.status < 400) {
        log({
          ts: new Date().toISOString(),
          level: "info",
          event: "tool_invocation",
          toolName,
          attempts,
          outcome: "success",
          durationMs: Date.now() - started,
        });
        return { ok: true, status: res.status, body: res.body, attempts };
      }
      lastError = `HTTP ${res.status}`;
      if (!isRetryable({ idempotent, status: res.status }) || attempt === RETRY_SPEC.maxAttempts - 1) {
        break;
      }
    } catch (e) {
      lastError = redactForLog((e as Error).message);
      if (!isRetryable({ idempotent, isTimeout: true }) || attempt === RETRY_SPEC.maxAttempts - 1) {
        break;
      }
    }
    const jitter = 1 + (Math.random() * 2 - 1) * RETRY_SPEC.jitterFraction;
    await sleep(baseDelayForAttempt(attempt) * jitter);
  }

  log({
    ts: new Date().toISOString(),
    level: "error",
    event: "tool_invocation",
    toolName,
    attempts,
    outcome: "failure",
    durationMs: Date.now() - started,
    error: lastError,
  });
  return { ok: false, status: lastStatus, error: lastError, attempts };
}
