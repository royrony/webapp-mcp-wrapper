// T081: CDP cookie-bridge auth strategy (FR-014 option b / FR-014a).
//
// Reuses a live, user-controlled Chrome (started with --remote-debugging-port) as the source of
// truth for authentication: it reads the target host's cookies from the browser over the Chrome
// DevTools Protocol and attaches them as a `Cookie` header on each tool request. On a 401/403 it
// re-reads the cookies (the user may have re-logged in) and, if a loginUrl is configured, navigates
// the browser there to prompt re-login. Cookies are held in memory only and never persisted in
// plaintext, logged, or written to config.
//
// Implemented with zero extra dependencies: the CDP HTTP endpoint (GET /json/version) yields the
// browser WebSocket URL, and Network.getCookies is called over Node's built-in global WebSocket.

import type { AuthStrategy, OutgoingRequest } from "./strategy.js";

export interface CdpCookieOptions {
  /** Chrome DevTools endpoint, e.g. http://localhost:9222. */
  cdpUrl: string;
  /** Hosts whose cookies to read/attach; when empty, cookies for the request URL are used. */
  cookieHosts?: string[];
  /** Optional page to open in the browser when a session appears missing/expired. */
  loginUrl?: string;
}

interface CdpCookie {
  name: string;
  value: string;
  domain: string;
}

/** Minimal CDP client over the browser-level WebSocket endpoint. */
class CdpClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor(private readonly cdpUrl: string) {}

  private async wsUrl(): Promise<string> {
    const base = this.cdpUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/json/version`);
    if (!res.ok) throw new Error(`CDP /json/version returned ${res.status}`);
    const info = (await res.json()) as { webSocketDebuggerUrl?: string };
    if (!info.webSocketDebuggerUrl) throw new Error("CDP endpoint did not advertise a webSocketDebuggerUrl");
    return info.webSocketDebuggerUrl;
  }

  private async connect(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return this.ws;
    const url = await this.wsUrl();
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", () => reject(new Error("CDP WebSocket connection failed")), { once: true });
    });
    ws.addEventListener("message", (ev: MessageEvent) => {
      let msg: { id?: number; result?: unknown; error?: { message?: string } };
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      } catch {
        return;
      }
      if (typeof msg.id === "number" && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message ?? "CDP error"));
        else p.resolve(msg.result);
      }
    });
    this.ws = ws;
    return ws;
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const ws = await this.connect();
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP ${method} timed out`));
        }
      }, 10_000);
    });
  }

  async getCookies(urls: string[]): Promise<CdpCookie[]> {
    // On the browser-level endpoint, Network.getCookies is unavailable; Storage.getCookies returns
    // all browser cookies (optionally scoped by browserContextId). We fetch all and filter by host.
    const result = (await this.send("Storage.getCookies")) as { cookies?: CdpCookie[] };
    const all = result.cookies ?? [];
    if (!urls.length) return all;
    const wantHosts = urls
      .map((u) => {
        try {
          return new URL(u).hostname;
        } catch {
          return null;
        }
      })
      .filter((h): h is string => Boolean(h));
    return all.filter((c) => {
      const d = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
      return wantHosts.some((h) => h === d || h.endsWith(`.${d}`) || d.endsWith(`.${h}`));
    });
  }

  async navigate(url: string): Promise<void> {
    // Best-effort: create a target so the user sees the login page. Ignore failures.
    try {
      await this.send("Target.createTarget", { url });
    } catch {
      /* non-fatal */
    }
  }

  close(): void {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}

function hostsForRequest(reqUrl: string, cookieHosts?: string[]): string[] {
  if (cookieHosts && cookieHosts.length) {
    return cookieHosts.map((h) => (h.startsWith("http") ? h : `https://${h}`));
  }
  try {
    return [new URL(reqUrl).origin];
  } catch {
    return [];
  }
}

function cookieHeaderFor(reqUrl: string, cookies: CdpCookie[]): string {
  let host: string;
  try {
    host = new URL(reqUrl).hostname;
  } catch {
    return "";
  }
  const matching = cookies.filter((c) => {
    const d = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain;
    return host === d || host.endsWith(`.${d}`);
  });
  return matching.map((c) => `${c.name}=${c.value}`).join("; ");
}

export function createCdpCookieStrategy(opts: CdpCookieOptions): AuthStrategy {
  const client = new CdpClient(opts.cdpUrl);
  // Cache cookies per set of hosts to avoid a CDP round-trip on every call.
  let cache: CdpCookie[] | null = null;

  async function refresh(reqUrl: string): Promise<CdpCookie[]> {
    const urls = hostsForRequest(reqUrl, opts.cookieHosts);
    cache = await client.getCookies(urls);
    return cache;
  }

  return {
    name: "session-reuse",
    async apply(req: OutgoingRequest): Promise<void> {
      const cookies = cache ?? (await refresh(req.url));
      const header = cookieHeaderFor(req.url, cookies);
      if (header) req.headers["cookie"] = header;
    },
    async recover(host: string): Promise<boolean> {
      // Re-read from the live browser in case the user re-authenticated.
      const before = cache ? cookieHeaderFor(`https://${host}/`, cache) : "";
      cache = await client.getCookies(hostsForRequest(`https://${host}/`, opts.cookieHosts));
      const after = cookieHeaderFor(`https://${host}/`, cache);
      if (after && after !== before) return true;
      // Still no valid session — prompt the user to log in, if we know where.
      if (opts.loginUrl) await client.navigate(opts.loginUrl);
      return false;
    },
    async close(): Promise<void> {
      client.close();
    },
  };
}
