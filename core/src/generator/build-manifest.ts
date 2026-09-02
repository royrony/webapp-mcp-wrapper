// T031: manifest generator — maps mapped DiscoveredFunctionality -> MCPToolDefinition with
// MCP annotations, excluding mutating tools from includedByDefault by default (FR-005, FR-007,
// FR-012, FR-018). This lives in the shared core so the mutating-exclusion default and tool set
// are identical across all three languages by construction (Constitution Principle VI).

import type { DiscoveredFunctionality, FunctionalityParameter } from "../models/discovered-functionality.js";
import type { MCPToolDefinition } from "../models/mcp-tool-definition.js";
import { classifyApiEndpoint } from "../extractor/classify.js";

function toInputSchema(params: FunctionalityParameter[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of params) {
    properties[p.name] = { type: p.type === "number" ? "number" : "string" };
    if (p.required) required.push(p.name);
  }
  const schema: Record<string, unknown> = { type: "object", properties };
  if (required.length) schema.required = required;
  return schema;
}

export interface BuildManifestOptions {
  /** When true, mutating tools are opted into the served scope (FR-012 opt-in). */
  includeMutating: boolean;
}

/** Build the tools.json array from a run's functionality.
 * Only `mapped` items become tools; skipped/inaccessible are reported but not generated.
 *
 * `includedByDefault` reflects the *default* (no-opt-in) scope and is therefore ALWAYS false for
 * mutating tools — the contract schema enforces this as a hard safety invariant (FR-012, Principle
 * II). The user's `--include-mutating` opt-in is recorded separately (see buildToolScope) rather
 * than by flipping this flag, so tools.json stays contract-compliant and byte-identical across
 * languages regardless of scope.
 * Tools are sorted by name so output is deterministic (byte-identical across languages). */
export function buildToolManifest(
  functionality: DiscoveredFunctionality[],
  _opts: BuildManifestOptions,
): MCPToolDefinition[] {
  const tools: MCPToolDefinition[] = [];
  for (const f of functionality) {
    if (f.mappingStatus !== "mapped") continue;
    const cls = classifyApiEndpoint(f.httpMethod, `${f.name} ${f.description}`);
    const readOnly = !f.mutating;
    tools.push({
      name: f.name,
      description: f.description,
      inputSchema: toInputSchema(f.parameters),
      outputSchema: f.expectedOutput,
      annotations: {
        readOnlyHint: readOnly,
        destructiveHint: cls.destructive,
        idempotentHint: cls.idempotent,
      },
      // ALWAYS false for mutating tools (schema-enforced). Opt-in lives in the tool scope.
      includedByDefault: readOnly,
      sourceIdentityKey: f.identityKey,
      ...(f.baseUrl ? { baseUrl: f.baseUrl } : {}),
    });
  }
  tools.sort((a, b) => a.name.localeCompare(b.name));
  return tools;
}

/** The served/validated tool scope: every tool included by default, plus mutating tools when the
 * user opted in via --include-mutating. This is the FR-012 opt-in, recorded without violating the
 * tools.json contract. serve/validate use this to decide which tools to expose (FR-022). */
export function buildToolScope(
  tools: MCPToolDefinition[],
  opts: BuildManifestOptions,
): string[] {
  return tools
    .filter((t) => t.includedByDefault || (opts.includeMutating && !t.annotations.readOnlyHint))
    .map((t) => t.name);
}
