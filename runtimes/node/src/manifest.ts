// Shared manifest loading for the Node runtime. Reads the language-neutral package
// (tools.json / package-manifest.json / oauthConfig.json) the core generated.

import { promises as fs } from "node:fs";
import path from "node:path";

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
  annotations: ToolAnnotations;
  includedByDefault: boolean;
  sourceIdentityKey: string;
  /** Absolute origin this tool's endpoint lives on (FR-025); when absent, dispatch uses the webapp origin. */
  baseUrl?: string;
}

export interface PackageManifest {
  webappTargetId: string;
  sourceRunId: string;
  targetLanguage: "node" | "python" | "java";
  runtimeVersion: string;
  deploymentModes: string[];
  runtimePolicy: {
    retry: { maxAttempts: number; backoff: string };
    logging: { structured: boolean };
  };
}

export type AuthStrategyName = "oauth" | "session-reuse" | "api-key";

export interface OAuthConfig {
  /** Selected auth strategy (FR-014). Defaults to "oauth" when omitted. */
  strategy?: AuthStrategyName;
  // OAuth
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  clientId?: string;
  redirectMode?: "loopback" | "hosted";
  hostedRedirectUri?: string;
  scopes?: string[];
  // session-reuse
  cdpUrl?: string;
  cookieHosts?: string[];
  loginUrl?: string;
  // api-key
  headerName?: string;
  valuePrefix?: string;
  fallback?: { mode?: "api-key" | "device-code"; notes?: string };
}

/** Narrowed view used by the OAuth flow implementations, where these fields are required. */
export interface OAuthStrategyConfig {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  redirectMode: "loopback" | "hosted";
  hostedRedirectUri?: string;
  scopes: string[];
}

/** Coerce a package auth config into an OAuthStrategyConfig, filling safe defaults. Throws if the
 * essential OAuth endpoints are missing (an oauth-strategy package must carry them). */
export function asOAuthConfig(cfg: OAuthConfig): OAuthStrategyConfig {
  if (!cfg.authorizationEndpoint || !cfg.tokenEndpoint || !cfg.clientId) {
    throw new Error("oauth strategy requires authorizationEndpoint, tokenEndpoint and clientId");
  }
  return {
    authorizationEndpoint: cfg.authorizationEndpoint,
    tokenEndpoint: cfg.tokenEndpoint,
    clientId: cfg.clientId,
    redirectMode: cfg.redirectMode ?? "loopback",
    hostedRedirectUri: cfg.hostedRedirectUri,
    scopes: cfg.scopes ?? [],
  };
}

export interface LoadedPackage {
  dir: string;
  manifest: PackageManifest;
  tools: ToolDefinition[];
  oauthConfig: OAuthConfig;
  /** Tool names in the served scope (FR-012 opt-in), or null to fall back to includedByDefault. */
  scope: string[] | null;
}

export async function loadPackage(dir: string): Promise<LoadedPackage> {
  const [manifestRaw, toolsRaw, oauthRaw] = await Promise.all([
    fs.readFile(path.join(dir, "package-manifest.json"), "utf8"),
    fs.readFile(path.join(dir, "tools.json"), "utf8"),
    fs.readFile(path.join(dir, "oauthConfig.json"), "utf8"),
  ]);
  let scope: string[] | null = null;
  try {
    const scopeRaw = await fs.readFile(path.join(dir, "tool-scope.json"), "utf8");
    scope = (JSON.parse(scopeRaw) as { tools: string[] }).tools;
  } catch {
    scope = null;
  }
  return {
    dir,
    manifest: JSON.parse(manifestRaw) as PackageManifest,
    tools: JSON.parse(toolsRaw) as ToolDefinition[],
    oauthConfig: JSON.parse(oauthRaw) as OAuthConfig,
    scope,
  };
}

/** Tools in the served scope: the tool-scope.json set when present, else includedByDefault. */
export function inScopeTools(tools: ToolDefinition[], scope?: string[] | null): ToolDefinition[] {
  if (scope) return tools.filter((t) => scope.includes(t.name));
  return tools.filter((t) => t.includedByDefault);
}
