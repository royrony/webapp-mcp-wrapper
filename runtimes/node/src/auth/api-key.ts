// T082: API-key / bearer auth strategy (FR-014 option c). Injects a user-supplied credential
// (from the WRAPPER_API_KEY env var — never from the package config) into a configured header.

import type { AuthStrategy, OutgoingRequest } from "./strategy.js";

export interface ApiKeyOptions {
  /** Header to place the credential in (default "Authorization"). */
  headerName?: string;
  /** Prefix prepended to the value (e.g. "Bearer "). */
  valuePrefix?: string;
  /** The credential value; supplied at deploy time via env, never stored in the package. */
  apiKey?: string;
}

export function createApiKeyStrategy(opts: ApiKeyOptions): AuthStrategy {
  const headerName = (opts.headerName ?? "Authorization").toLowerCase();
  const prefix = opts.valuePrefix ?? "";
  return {
    name: "api-key",
    async apply(req: OutgoingRequest): Promise<void> {
      if (opts.apiKey) req.headers[headerName] = `${prefix}${opts.apiKey}`;
    },
  };
}
