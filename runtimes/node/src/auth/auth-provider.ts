// T062 + T067: wire OAuth-authenticated dispatch into the server, with an api-key fallback.
// Produces the `getToken` the server's dispatch path attaches to every tool call, sourcing it
// from the token store (populated by the OAuth loopback/hosted flow) or the documented
// api-key fallback for webapps without OAuth (contracts/oauth-config.schema.json `fallback`).

import type { OAuthConfig } from "../manifest.js";
import { asOAuthConfig } from "../manifest.js";
import { runLoopbackFlow } from "./oauth-loopback.js";
import { createTokenStore, type TokenStore } from "./token-store.js";

export interface AuthProviderOptions {
  mode: "stdio" | "streamable-http";
  session: string;
  /** api-key fallback value (never logged); used only when oauthConfig.fallback.mode === "api-key". */
  apiKey?: string;
  store?: TokenStore;
}

export interface AuthProvider {
  getToken(): Promise<string | undefined>;
}

/** Build a token provider from the package's OAuth config. */
export function createAuthProvider(config: OAuthConfig, opts: AuthProviderOptions): AuthProvider {
  // Documented fallback: static API key for webapps that don't support OAuth.
  if (config.fallback?.mode === "api-key" && opts.apiKey) {
    return { getToken: async () => opts.apiKey };
  }

  const store = opts.store ?? createTokenStore(opts.mode);

  return {
    async getToken(): Promise<string | undefined> {
      const existing = await store.load(opts.session);
      const now = Date.now();
      if (existing && existing.expiresAt > now + 30_000) {
        return existing.accessToken;
      }
      // Token missing/expired: run the interactive OAuth flow (loopback for stdio).
      if (opts.mode === "stdio") {
        const tokens = await runLoopbackFlow(asOAuthConfig(config));
        await store.save(opts.session, tokens);
        return tokens.accessToken;
      }
      // Hosted mode completes its flow out-of-band via the public redirect; if we have no
      // valid token here, surface undefined so the call proceeds unauthenticated (and likely 401),
      // which the reliability/logging layer records rather than crashing.
      return existing?.accessToken;
    },
  };
}
