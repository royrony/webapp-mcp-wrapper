// OAuthConfig — matches contracts/oauth-config.schema.json. Never contains secrets.

export interface OAuthFallback {
  mode?: "api-key" | "device-code";
  notes?: string;
}

export interface OAuthConfig {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** Public OAuth client identifier; never a client secret. */
  clientId: string;
  redirectMode: "loopback" | "hosted";
  /** Required when redirectMode is 'hosted'. */
  hostedRedirectUri?: string;
  scopes: string[];
  fallback?: OAuthFallback;
}
