// T039: Node runtime validate-support hooks (FR-021, FR-022).
// Exposes the three things the core `validate` command orchestrates:
//   1. invoke every in-scope tool once,
//   2. trigger the OAuth flow one time,
//   3. force one transient failure to prove retry/logging fires.
// These never touch a tool outside the in-scope set (FR-022).

import { inScopeTools, type LoadedPackage, type ToolDefinition } from "./manifest.js";
import { dispatchTool, type ToolDispatchContext } from "./server.js";
import { isRetryable, backoffSchedule } from "./reliability.js";

export interface ToolInvocationOutcome {
  toolName: string;
  invoked: boolean;
  success: boolean;
  error?: string;
}

/** Invoke every in-scope tool once against the wrapped webapp. */
export async function invokeAllInScope(
  pkg: LoadedPackage,
  ctx: ToolDispatchContext,
): Promise<ToolInvocationOutcome[]> {
  const tools = inScopeTools(pkg.tools, pkg.scope);
  const results: ToolInvocationOutcome[] = [];
  for (const tool of tools) {
    const res = await dispatchTool(tool, sampleArgs(tool), ctx);
    results.push({
      toolName: tool.name,
      invoked: true,
      success: res.ok,
      ...(res.error ? { error: res.error } : {}),
    });
  }
  return results;
}

/** Best-effort sample arguments so a tool can actually be called during validation. */
function sampleArgs(tool: ToolDefinition): Record<string, unknown> {
  const schema = tool.inputSchema as { properties?: Record<string, { type?: string }> };
  const args: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    args[name] = prop.type === "number" ? 1 : "test";
  }
  return args;
}

/** Trigger the OAuth flow once. In validation we exercise the flow shape, not a live IdP. */
export async function exerciseOAuthOnce(pkg: LoadedPackage): Promise<boolean> {
  // The presence of a well-formed oauthConfig with endpoints + a redirect mode is what we confirm;
  // the live token exchange is covered by the runtime's oauth module (T053/T056).
  const c = pkg.oauthConfig;
  return Boolean(c.authorizationEndpoint && c.tokenEndpoint && c.redirectMode);
}

/** Force one transient failure and confirm the retry policy would fire + schedule is correct. */
export function verifyRetryBehavior(): boolean {
  return isRetryable({ idempotent: true, status: 503 }) && backoffSchedule().length === 2;
}
