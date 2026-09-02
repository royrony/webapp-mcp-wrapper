// T063: `serve --mode streamable-http` for the Node runtime (FR-015, FR-016).
// Runs the generated package as a hosted service using the MCP Streamable HTTP transport
// (never the deprecated HTTP+SSE transport — Constitution Principle I). The SDK transport is
// imported lazily so this module builds without the SDK present.

import type { LoadedPackage } from "../manifest.js";
import { registerTools, type ToolDispatchContext } from "../server.js";

export interface StreamableHttpOptions {
  port: number;
  redirectUri?: string;
  baseUrl: string;
}

/** Start a Streamable HTTP MCP server for the package. Returns a stop() handle. */
export async function serveStreamableHttp(
  pkg: LoadedPackage,
  opts: StreamableHttpOptions,
): Promise<{ port: number; stop: () => Promise<void> }> {
  const ctx: ToolDispatchContext = { baseUrl: opts.baseUrl };
  const { register } = await registerTools(pkg, ctx);

  const sdk = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const httpMod = await import("@modelcontextprotocol/sdk/server/streamableHttp.js");

  const McpServer = (sdk as unknown as { McpServer: new (o: unknown) => { connect(t: unknown): Promise<void> } & Parameters<typeof register>[0] }).McpServer;
  const server = new McpServer({
    name: `wrapper-${pkg.manifest.webappTargetId}`,
    version: pkg.manifest.runtimeVersion,
  });
  register(server);

  const TransportCtor = (httpMod as unknown as {
    StreamableHTTPServerTransport: new (o: unknown) => { close?: () => Promise<void> };
  }).StreamableHTTPServerTransport;
  const transport = new TransportCtor({ port: opts.port });
  await server.connect(transport);

  return {
    port: opts.port,
    stop: async () => {
      await transport.close?.();
    },
  };
}
