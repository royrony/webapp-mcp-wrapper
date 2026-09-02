// Page/HTTP fetch abstraction.
//
// The plan mandates a Playwright headless-browser crawler for JS-rendered SPAs. To keep
// the extraction pipeline testable without a browser binary present, crawling goes through
// this interface: a Playwright-backed implementation is used when a browser is available,
// and a dependency-free `fetch`-based implementation covers server-rendered targets and the
// test fixture. The crawler/api-sniffer/spec-discovery logic depends only on this interface,
// so swapping engines never changes discovery behavior.

export interface FetchedResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  contentType: string;
}

export interface Fetcher {
  /** Fetch a URL (following redirects). Throws only on network-level failure. */
  fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<FetchedResponse>;
}

/** A `fetch`-based Fetcher. Works for server-rendered pages and JSON APIs. */
export class HttpFetcher implements Fetcher {
  constructor(private readonly extraHeaders: Record<string, string> = {}) {}

  async fetch(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<FetchedResponse> {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: { ...this.extraHeaders, ...(init.headers ?? {}) },
      body: init.body,
      redirect: "follow",
    });
    const body = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    return {
      url: res.url || url,
      status: res.status,
      headers,
      body,
      contentType: res.headers.get("content-type") ?? "",
    };
  }
}

/** Try to build a Playwright-backed fetcher; fall back to HttpFetcher if unavailable.
 * Kept dynamic so the browser dependency is optional at runtime. */
export async function createFetcher(
  extraHeaders: Record<string, string> = {},
): Promise<Fetcher> {
  if (process.env.WRAPPER_FORCE_HTTP_FETCHER === "1") {
    return new HttpFetcher(extraHeaders);
  }
  try {
    const pw = await import("playwright");
    const browser = await pw.chromium.launch();
    return new PlaywrightFetcher(browser, extraHeaders);
  } catch {
    // No browser binary / launch failed — server-rendered targets still work via fetch.
    return new HttpFetcher(extraHeaders);
  }
}

// Minimal structural typing for the bits of Playwright we use, to avoid a hard type dep.
interface PwBrowserLike {
  newPage(opts?: unknown): Promise<PwPageLike>;
  close(): Promise<void>;
}
interface PwPageLike {
  goto(url: string, opts?: unknown): Promise<{ status(): number; headers(): Record<string, string> } | null>;
  content(): Promise<string>;
  on(event: string, cb: (arg: unknown) => void): void;
  close(): Promise<void>;
}

export class PlaywrightFetcher implements Fetcher {
  constructor(
    private readonly browser: PwBrowserLike,
    private readonly extraHeaders: Record<string, string> = {},
  ) {}

  async fetch(url: string): Promise<FetchedResponse> {
    const page = await this.browser.newPage({ extraHTTPHeaders: this.extraHeaders });
    try {
      const resp = await page.goto(url, { waitUntil: "networkidle" });
      const body = await page.content();
      const status = resp?.status() ?? 0;
      const headers = resp?.headers() ?? {};
      return {
        url,
        status,
        headers,
        body,
        contentType: headers["content-type"] ?? "text/html",
      };
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}
