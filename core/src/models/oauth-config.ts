// AuthConfig — matches contracts/oauth-config.schema.json (filename kept for compatibility).
// Pluggable per constitution v1.2.0 Principle V. Never contains secrets.

export interface OAuthFallback {
  mode?: "api-key" | "device-code";
  notes?: string;
}

export type AuthStrategy = "oauth" | "session-reuse" | "api-key";

export interface AuthConfig {
  /** Selected strategy (FR-014). Defaults to "oauth" when omitted, for backward compatibility. */
  strategy?: AuthStrategy;

  // --- OAuth strategy fields ---
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  /** Public OAuth client identifier; never a client secret. */
  clientId?: string;
  redirectMode?: "loopback" | "hosted";
  /** Required when redirectMode is 'hosted'. */
  hostedRedirectUri?: string;
  scopes?: string[];

  // --- session-reuse strategy fields ---
  /** Default Chrome DevTools endpoint (e.g. http://localhost:9222); overridable at deploy time. */
  cdpUrl?: string;
  /** Hosts whose cookies the runtime reads and attaches (typically the tools' baseUrl hosts). */
  cookieHosts?: string[];
  /** Optional URL to navigate the browser to when a session is missing/expired. */
  loginUrl?: string;

  // --- api-key strategy fields ---
  /** Header the credential is sent in (e.g. Authorization, X-API-Key). */
  headerName?: string;
  /** Optional prefix prepended to the credential value (e.g. "Bearer "). */
  valuePrefix?: string;

  fallback?: OAuthFallback;
}

/** Backward-compatible alias: existing code imports `OAuthConfig`. */
export type OAuthConfig = AuthConfig;

