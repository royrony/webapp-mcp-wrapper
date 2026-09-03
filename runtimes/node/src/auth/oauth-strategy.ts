// T080: OAuth auth strategy — adapts the existing token provider (createAuthProvider) to the
// pluggable AuthStrategy interface, attaching `Authorization: Bearer <token>` per request.

import type { AuthStrategy, OutgoingRequest } from "./strategy.js";
import type { AuthProvider } from "./auth-provider.js";

export function createOAuthStrategy(provider: AuthProvider): AuthStrategy {
  return {
    name: "oauth",
    async apply(req: OutgoingRequest): Promise<void> {
      const token = await provider.getToken();
      if (token) req.headers["authorization"] = `Bearer ${token}`;
    },
    // A fresh getToken() already refreshes an expired/near-expiry token, so a 401 recovery is a
    // no-op beyond forcing the next apply() to fetch again (the provider handles expiry internally).
    async recover(): Promise<boolean> {
      return false;
    },
  };
}
