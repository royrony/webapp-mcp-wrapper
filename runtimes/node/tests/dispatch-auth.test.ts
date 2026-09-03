// T085: Node reference-runtime tests for per-tool baseUrl dispatch (FR-025) and the pluggable
// auth strategies (FR-014/FR-014a): api-key header injection, session-reuse Cookie attachment,
// and one-time 401 recovery.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { toolToRequest, dispatchTool, type ToolDispatchContext } from "../src/server.js";
import type { ToolDefinition } from "../src/manifest.js";
import { createApiKeyStrategy } from "../src/auth/api-key.js";

function tool(partial: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: "get_thing",
    description: "Reads a thing",
    inputSchema: { type: "object", properties: {} },
    outputSchema: null,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    includedByDefault: true,
    sourceIdentityKey: "GET /social-user/user/getCurrentUserDetails",
    ...partial,
  };
}

describe("per-tool baseUrl dispatch (FR-025)", () => {
  it("dispatches to the tool's own baseUrl when present", () => {
    const { url, method } = toolToRequest(
      tool({ baseUrl: "https://api.example.com" }),
      {},
      "https://app.example.com",
    );
    expect(method).toBe("GET");
    expect(url).toBe("https://api.example.com/social-user/user/getCurrentUserDetails");
  });

  it("falls back to the webapp origin when the tool has no baseUrl", () => {
    const { url } = toolToRequest(tool({ baseUrl: undefined }), {}, "https://app.example.com");
    expect(url).toBe("https://app.example.com/social-user/user/getCurrentUserDetails");
  });

  it("appends non-path GET args as query params", () => {
    const { url } = toolToRequest(
      tool({ baseUrl: "https://api.example.com", sourceIdentityKey: "GET /social-post/post/all" }),
      { pageOffset: 1, pageSize: 10 },
      "https://app.example.com",
    );
    expect(url).toContain("https://api.example.com/social-post/post/all?");
    expect(url).toContain("pageOffset=1");
    expect(url).toContain("pageSize=10");
  });
});

describe("api-key auth strategy (FR-014)", () => {
  it("injects the configured header with prefix", async () => {
    const strat = createApiKeyStrategy({ headerName: "Authorization", valuePrefix: "Bearer ", apiKey: "SECRET" });
    const req = { url: "https://api.example.com/x", method: "GET", headers: {} as Record<string, string> };
    await strat.apply(req);
    expect(req.headers["authorization"]).toBe("Bearer SECRET");
  });

  it("adds nothing when no key is supplied", async () => {
    const strat = createApiKeyStrategy({ headerName: "X-API-Key" });
    const req = { url: "https://api.example.com/x", method: "GET", headers: {} as Record<string, string> };
    await strat.apply(req);
    expect(Object.keys(req.headers)).toHaveLength(0);
  });
});

describe("dispatchTool with auth", () => {
  it("attaches the strategy's headers to the outgoing request", async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      seen.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const ctx: ToolDispatchContext = {
      baseUrl: "https://app.example.com",
      auth: createApiKeyStrategy({ apiKey: "K", valuePrefix: "Bearer " }),
    };
    const res = await dispatchTool(tool({ baseUrl: "https://api.example.com" }), {}, ctx, { fetchImpl });
    expect(res.ok).toBe(true);
    expect(seen[0].url).toBe("https://api.example.com/social-user/user/getCurrentUserDetails");
    expect(seen[0].headers["authorization"]).toBe("Bearer K");
  });

  it("recovers once on 401 then retries with fresh auth", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      // First call 401, second (post-recover) 200.
      return call === 1
        ? new Response("no", { status: 401 })
        : new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const recover = vi.fn(async () => true);
    const ctx: ToolDispatchContext = {
      baseUrl: "https://app.example.com",
      auth: { name: "test", apply: async () => {}, recover },
    };
    const res = await dispatchTool(tool({ baseUrl: "https://api.example.com" }), {}, ctx, { fetchImpl });
    expect(recover).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
    expect(call).toBe(2);
  });

  it("does not retry when recover reports no recovery", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    const recover = vi.fn(async () => false);
    const ctx: ToolDispatchContext = {
      baseUrl: "https://app.example.com",
      auth: { name: "test", apply: async () => {}, recover },
    };
    const res = await dispatchTool(tool({ baseUrl: "https://api.example.com" }), {}, ctx, { fetchImpl });
    expect(recover).toHaveBeenCalledOnce();
    expect(res.ok).toBe(false);
  });
});

describe("session-reuse (CDP cookie-bridge) auth strategy (FR-014a)", () => {
  const OriginalWS = (globalThis as { WebSocket?: unknown }).WebSocket;

  beforeEach(() => {
    // Mock the CDP HTTP endpoint.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) => {
        if (String(u).endsWith("/json/version")) {
          return new Response(JSON.stringify({ webSocketDebuggerUrl: "ws://localhost:9222/devtools/browser/x" }), {
            status: 200,
          });
        }
        return new Response("{}", { status: 200 });
      }),
    );
    // Mock a CDP WebSocket that answers Network.getCookies.
    class MockWS {
      static OPEN = 1;
      readyState = 1;
      private listeners: Record<string, Array<(ev: unknown) => void>> = {};
      constructor(_url: string) {
        setTimeout(() => this.emit("open", {}), 0);
      }
      addEventListener(type: string, cb: (ev: unknown) => void) {
        (this.listeners[type] ??= []).push(cb);
      }
      send(data: string) {
        const msg = JSON.parse(data);
        if (msg.method === "Storage.getCookies") {
          const result = {
            cookies: [{ name: "nw_prod_oauthToken", value: "abc123", domain: "api.example.com" }],
          };
          setTimeout(() => this.emit("message", { data: JSON.stringify({ id: msg.id, result }) }), 0);
        }
      }
      close() {}
      private emit(type: string, ev: unknown) {
        for (const cb of this.listeners[type] ?? []) cb(ev);
      }
    }
    vi.stubGlobal("WebSocket", MockWS as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (OriginalWS) (globalThis as { WebSocket?: unknown }).WebSocket = OriginalWS;
  });

  it("reads cookies from the live browser and attaches a Cookie header for the request host", async () => {
    const { createCdpCookieStrategy } = await import("../src/auth/cdp-cookie.js");
    const strat = createCdpCookieStrategy({ cdpUrl: "http://localhost:9222", cookieHosts: ["api.example.com"] });
    const req = { url: "https://api.example.com/social-user/user/getCurrentUserDetails", method: "GET", headers: {} as Record<string, string> };
    await strat.apply(req);
    expect(req.headers["cookie"]).toBe("nw_prod_oauthToken=abc123");
    await strat.close?.();
  });
});
