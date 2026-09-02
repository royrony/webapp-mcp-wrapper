// T056: OAuth 2.1 + PKCE hosted-redirect flow for the Node runtime (FR-014, FR-016).
// Used in streamable-http/hosted mode: the authorization uses a configured public redirect URI
// instead of a 127.0.0.1 loopback. Same PKCE machinery as the loopback flow.

import { randomBytes } from "node:crypto";

import type { OAuthConfig } from "../manifest.js";
import { buildAuthorizationUrl, generatePkce, type TokenSet } from "./oauth-loopback.js";

export interface HostedFlowState {
  authorizationUrl: string;
  verifier: string;
  state: string;
  redirectUri: string;
}

/** Begin the hosted flow: produce the URL to redirect the user to. The caller (hosted server)
 * completes it when the public redirect URI receives the code. */
export function beginHostedFlow(config: OAuthConfig): HostedFlowState {
  if (config.redirectMode !== "hosted" || !config.hostedRedirectUri) {
    throw new Error("hosted flow requires redirectMode 'hosted' and a hostedRedirectUri");
  }
  const { verifier, challenge } = generatePkce();
  const state = randomBytes(8).toString("hex");
  const authorizationUrl = buildAuthorizationUrl(config, config.hostedRedirectUri, challenge, state);
  return { authorizationUrl, verifier, state, redirectUri: config.hostedRedirectUri };
}

/** Complete the hosted flow given the code returned to the public redirect URI. */
export async function completeHostedFlow(
  config: OAuthConfig,
  flow: HostedFlowState,
  code: string,
  returnedState: string,
): Promise<TokenSet> {
  if (returnedState !== flow.state) throw new Error("state mismatch");
  const res = await fetch(config.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: flow.redirectUri,
      client_id: config.clientId,
      code_verifier: flow.verifier,
    }).toString(),
  });
  const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  };
}
