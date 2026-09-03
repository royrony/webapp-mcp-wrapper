// T033: Node.js runtime stdio entrypoint. Dynamically registers tools from tools.json
// via @modelcontextprotocol/sdk (FR-005, FR-006; research.md #10). The SDK import is
// dynamic so the package builds and its dispatch logic is testable without the SDK binary
// present; T062/T066 wire OAuth + reliability into the dispatch path.

import { loadPackage, inScopeTools, type ToolDefinition, type LoadedPackage } from "./manifest.js";
import { invokeWithReliability } from "./reliability.js";
import type { AuthStrategy, OutgoingRequest } from "./auth/strategy.js";

export interface ToolDispatchContext {
  /** Base URL of the wrapped webapp; used only when a tool has no own baseUrl (FR-025). */
  baseUrl: string;
  /** Active auth strategy (OAuth / session-reuse / api-key); applied to every outgoing request. */
  auth?: AuthStrategy;
  /** Test hook: force a transient failure on the first attempt (validate --simulate-transient-failure). */
  simulateTransientFailure?: boolean;
}

/** Reconstruct a callable HTTP request for a tool from its sourceIdentityKey ("METHOD /path").
 * Dispatches to the tool's own `baseUrl` when present (FR-025), else the webapp origin. */
export function toolToRequest(tool: ToolDefinition, args: Record<string, unknown>, baseUrl: string): {
  url: string;
  method: string;
} {
  const [method, pathTemplate] = tool.sourceIdentityKey.split(" ");
  const origin = tool.baseUrl && tool.baseUrl.length ? tool.baseUrl : baseUrl;
  let filledPath = pathTemplate;
  // Substitute {id}-style path params from args.
  for (const [k, v] of Object.entries(args)) {
    filledPath = filledPath.replace(`{${k}}`, encodeURIComponent(String(v)));
  }
  const url = new URL(filledPath, origin);
  if (method === "GET") {
    for (const [k, v] of Object.entries(args)) {
      if (!pathTemplate.includes(`{${k}}`)) url.searchParams.set(k, String(v));
    }
  }
  return { url: url.toString(), method };
}

/** Invoke a single tool against the wrapped webapp with reliability + pluggable auth. */
export async function dispatchTool(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  ctx: ToolDispatchContext,
  deps: { fetchImpl?: typeof fetch } = {},
): Promise<{ ok: boolean; body?: unknown; error?: string; attempts: number }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const { url, method } = toolToRequest(tool, args, ctx.baseUrl);
  const idempotent = tool.annotations.idempotentHint;
  let firstAttemptFailed = false;
  let recoveredOnce = false;

  const doFetch = async (): Promise<{ status: number; body: unknown }> => {
    const req: OutgoingRequest = { url, method, headers: {} };
    if (ctx.auth) await ctx.auth.apply(req);
    const res = await fetchImpl(url, { method, headers: req.headers });
    // One-time auth recovery on 401/403 (FR-014a): re-read session, then retry once.
    if ((res.status === 401 || res.status === 403) && ctx.auth?.recover && !recoveredOnce) {
      recoveredOnce = true;
      const host = (() => {
        try {
          return new URL(url).host;
        } catch {
          return "";
        }
      })();
      const recovered = await ctx.auth.recover(host);
      if (recovered) {
        const retryReq: OutgoingRequest = { url, method, headers: {} };
        await ctx.auth.apply(retryReq);
        const retryRes = await fetchImpl(url, { method, headers: retryReq.headers });
        return { status: retryRes.status, body: await readBody(retryRes) };
      }
    }
    return { status: res.status, body: await readBody(res) };
  };

  return invokeWithReliability(tool.name, idempotent, async (attempt) => {
    if (ctx.simulateTransientFailure && attempt === 0 && !firstAttemptFailed) {
      firstAttemptFailed = true;
      return { status: 503, body: null };
    }
    return doFetch();
  });
}

async function readBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return await res.text().catch(() => null);
  }
}

/** Register all in-scope tools with an MCP server instance. */
export async function registerTools(pkg: LoadedPackage, ctx: ToolDispatchContext): Promise<{
  register: (server: McpServerLike) => void;
  tools: ToolDefinition[];
}> {
  const tools = inScopeTools(pkg.tools, pkg.scope);
  const register = (server: McpServerLike) => {
    for (const tool of tools) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        },
        async (args: Record<string, unknown>) => {
          const result = await dispatchTool(tool, args ?? {}, ctx);
          return {
            content: [{ type: "text", text: JSON.stringify(result.body ?? result.error ?? null) }],
            isError: !result.ok,
          };
        },
      );
    }
  };
  return { register, tools };
}

interface McpServerLike {
  registerTool(
    name: string,
    def: { description: string; inputSchema: Record<string, unknown>; annotations: unknown },
    handler: (args: Record<string, unknown>) => Promise<unknown>,
  ): void;
}

/** T083: build the active AuthStrategy from the package's authConfig.strategy (default oauth). */
export async function createAuthStrategy(pkg: LoadedPackage): Promise<AuthStrategy> {
  const cfg = pkg.oauthConfig;
  const strategy = cfg.strategy ?? "oauth";

  if (strategy === "session-reuse") {
    const { createCdpCookieStrategy } = await import("./auth/cdp-cookie.js");
    // Deploy-time override wins over the recorded default.
    const cdpUrl = process.env.WRAPPER_CDP_URL ?? cfg.cdpUrl ?? "http://localhost:9222";
    return createCdpCookieStrategy({ cdpUrl, cookieHosts: cfg.cookieHosts, loginUrl: cfg.loginUrl });
  }

  if (strategy === "api-key") {
    const { createApiKeyStrategy } = await import("./auth/api-key.js");
    return createApiKeyStrategy({
      headerName: cfg.headerName,
      valuePrefix: cfg.valuePrefix,
      apiKey: process.env.WRAPPER_API_KEY,
    });
  }

  // Default: OAuth (also covers the documented api-key fallback inside createAuthProvider).
  const { createAuthProvider } = await import("./auth/auth-provider.js");
  const { createOAuthStrategy } = await import("./auth/oauth-strategy.js");
  const provider = createAuthProvider(cfg, {
    mode: "stdio",
    session: pkg.manifest.webappTargetId,
    apiKey: process.env.WRAPPER_API_KEY,
  });
  return createOAuthStrategy(provider);
}

/** stdio entrypoint: `wrapper-runtime-node <package-dir> [--mode stdio]`. */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const dir = argv[0];
  if (!dir) {
    process.stderr.write("usage: wrapper-runtime-node <package-dir>\n");
    process.exit(2);
  }
  const pkg = await loadPackage(dir);
  const baseUrl = `https://${pkg.manifest.webappTargetId}`;

  // T083: select the runtime auth strategy from authConfig.strategy (default oauth).
  const auth = await createAuthStrategy(pkg);
  const ctx: ToolDispatchContext = { baseUrl, auth };

  try {
    const sdk = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const stdioMod = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const server = new (sdk as unknown as { McpServer: new (o: unknown) => McpServerLike & { connect(t: unknown): Promise<void> } }).McpServer(
      { name: `wrapper-${pkg.manifest.webappTargetId}`, version: pkg.manifest.runtimeVersion },
    );
    const { register } = await registerTools(pkg, ctx);
    register(server);
    const Transport = (stdioMod as unknown as { StdioServerTransport: new () => unknown }).StdioServerTransport;
    await server.connect(new Transport());
  } catch (e) {
    process.stderr.write(
      `MCP SDK unavailable or failed to start (${(e as Error).message}). ` +
        `Package loaded with ${pkg.tools.length} tools.\n`,
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
