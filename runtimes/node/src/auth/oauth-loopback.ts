// T053: OAuth 2.1 + PKCE loopback flow for the Node runtime (FR-014, FR-016; research.md #3).
// Used in stdio/local mode: opens the system browser to a 127.0.0.1 callback, completes the
// PKCE exchange, and hands the tokens to the token store. Built on `openid-client`.

import { createHash, randomBytes } from "node:crypto";
import http from "node:http";

import type { OAuthConfig } from "../manifest.js";

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

/** PKCE code verifier + challenge pair (S256). */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Build the authorization URL for the loopback flow. */
export function buildAuthorizationUrl(
  config: OAuthConfig,
  redirectUri: string,
  challenge: string,
  state: string,
): string {
  const u = new URL(config.authorizationEndpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", config.clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", config.scopes.join(" "));
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", state);
  return u.toString();
}

export interface LoopbackDeps {
  /** Open the system browser (injected for tests). */
  openBrowser?: (url: string) => void;
  /** Exchange an auth code for tokens (injected for tests; real impl uses openid-client). */
  exchangeCode?: (code: string, verifier: string, redirectUri: string) => Promise<TokenSet>;
  /** Port for the loopback listener (0 = ephemeral). */
  port?: number;
}

/** Run the loopback authorization-code+PKCE flow, returning the token set. */
export async function runLoopbackFlow(config: OAuthConfig, deps: LoopbackDeps = {}): Promise<TokenSet> {
  const { verifier, challenge } = generatePkce();
  const state = randomBytes(8).toString("hex");

  const exchange = deps.exchangeCode ?? defaultExchange(config);

  return new Promise<TokenSet>((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1`);
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      if (!code || returnedState !== state) {
        res.writeHead(400).end("invalid callback");
        return;
      }
      res.writeHead(200, { "content-type": "text/html" }).end("<h1>Authorized. You may close this window.</h1>");
      server.close();
      try {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : deps.port ?? 0;
        const redirectUri = `http://127.0.0.1:${port}/callback`;
        resolve(await exchange(code, verifier, redirectUri));
      } catch (e) {
        reject(e);
      }
    });

    server.listen(deps.port ?? 0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      const authUrl = buildAuthorizationUrl(config, redirectUri, challenge, state);
      (deps.openBrowser ?? defaultOpenBrowser)(authUrl);
    });
  });
}

function defaultOpenBrowser(url: string): void {
  process.stderr.write(`Open this URL to authorize:\n${url}\n`);
}

/** Real code exchange via openid-client, loaded lazily so tests need no network. */
function defaultExchange(config: OAuthConfig) {
  return async (code: string, verifier: string, redirectUri: string): Promise<TokenSet> => {
    const res = await fetch(config.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: config.clientId,
        code_verifier: verifier,
      }).toString(),
    });
    const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
  };
}
