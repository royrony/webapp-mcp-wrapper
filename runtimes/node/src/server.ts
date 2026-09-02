// T033: Node.js runtime stdio entrypoint. Dynamically registers tools from tools.json
// via @modelcontextprotocol/sdk (FR-005, FR-006; research.md #10). The SDK import is
// dynamic so the package builds and its dispatch logic is testable without the SDK binary
// present; T062/T066 wire OAuth + reliability into the dispatch path.

import { loadPackage, inScopeTools, type ToolDefinition, type LoadedPackage } from "./manifest.js";
import { invokeWithReliability } from "./reliability.js";

export interface ToolDispatchContext {
  /** Base URL of the wrapped webapp; tool calls resolve their path against it. */
  baseUrl: string;
  /** Returns the current bearer token (from the OAuth token store), or undefined. */
  getToken?: () => Promise<string | undefined>;
  /** Test hook: force a transient failure on the first attempt (validate --simulate-transient-failure). */
  simulateTransientFailure?: boolean;
}

/** Reconstruct a callable HTTP request for a tool from its sourceIdentityKey ("METHOD /path"). */
export function toolToRequest(tool: ToolDefinition, args: Record<string, unknown>, baseUrl: string): {
  url: string;
  method: string;
} {
  const [method, pathTemplate] = tool.sourceIdentityKey.split(" ");
  let filledPath = pathTemplate;
  // Substitute {id}-style path params from args.
  for (const [k, v] of Object.entries(args)) {
    filledPath = filledPath.replace(`{${k}}`, encodeURIComponent(String(v)));
  }
  const url = new URL(filledPath, baseUrl);
  if (method === "GET") {
    for (const [k, v] of Object.entries(args)) {
      if (!pathTemplate.includes(`{${k}}`)) url.searchParams.set(k, String(v));
    }
  }
  return { url: url.toString(), method };
}

/** Invoke a single tool against the wrapped webapp with reliability + auth. */
export async function dispatchTool(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  ctx: ToolDispatchContext,
  deps: { fetchImpl?: typeof fetch; log?: Parameters<typeof invokeWithReliability>[3] extends infer _ ? never : never } = {},
): Promise<{ ok: boolean; body?: unknown; error?: string; attempts: number }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const { url, method } = toolToRequest(tool, args, ctx.baseUrl);
  const idempotent = tool.annotations.idempotentHint;
  let firstAttemptFailed = false;

  return invokeWithReliability(tool.name, idempotent, async (attempt) => {
    if (ctx.simulateTransientFailure && attempt === 0 && !firstAttemptFailed) {
      firstAttemptFailed = true;
      return { status: 503, body: null };
    }
    const token = ctx.getToken ? await ctx.getToken() : undefined;
    const headers: Record<string, string> = {};
    if (token) headers["authorization"] = `Bearer ${token}`;
    const res = await fetchImpl(url, { method, headers });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => null);
    }
    return { status: res.status, body };
  });
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

/** stdio entrypoint: `wrapper-runtime-node <package-dir> [--mode stdio]`. */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const dir = argv[0];
  if (!dir) {
    process.stderr.write("usage: wrapper-runtime-node <package-dir>\n");
    process.exit(2);
  }
  const pkg = await loadPackage(dir);
  const baseUrl = `https://${pkg.manifest.webappTargetId}`;

  // T062/T067: wire OAuth-authenticated dispatch. Every tool call attaches the current token.
  const { createAuthProvider } = await import("./auth/auth-provider.js");
  const auth = createAuthProvider(pkg.oauthConfig, {
    mode: "stdio",
    session: pkg.manifest.webappTargetId,
    apiKey: process.env.WRAPPER_API_KEY,
  });
  const ctx: ToolDispatchContext = { baseUrl, getToken: () => auth.getToken() };

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
