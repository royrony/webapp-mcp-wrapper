// T080: pluggable runtime auth strategy for the Node reference runtime (FR-014).
// A strategy attaches credentials to an outgoing tool request and, on a 401/403, attempts a
// one-time recovery (token refresh, re-reading a live browser session, etc.) so an expired
// session is repaired transparently rather than failing opaquely (FR-014a). Secrets are never
// logged or persisted in plaintext by any strategy.

export interface OutgoingRequest {
  /** Absolute request URL (already resolved to the tool's own baseUrl per FR-025). */
  url: string;
  method: string;
  headers: Record<string, string>;
}

export interface AuthStrategy {
  /** Human-readable strategy name for logs (never includes secrets). */
  readonly name: string;
  /** Mutate `req.headers` in place to authenticate the request. */
  apply(req: OutgoingRequest): Promise<void>;
  /**
   * Called once after a 401/403 to attempt recovery for the given request host.
   * Returns true if recovery was performed (the caller should retry the request once),
   * false if nothing could be done.
   */
  recover?(host: string): Promise<boolean>;
  /** Release any held resources (e.g., a CDP connection). */
  close?(): Promise<void>;
}
