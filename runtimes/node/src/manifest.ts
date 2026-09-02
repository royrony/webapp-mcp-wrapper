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

export interface OAuthConfig {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  redirectMode: "loopback" | "hosted";
  hostedRedirectUri?: string;
  scopes: string[];
  fallback?: { mode?: "api-key" | "device-code"; notes?: string };
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
