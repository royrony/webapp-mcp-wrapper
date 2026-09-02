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
  /** HTTP method used for an observed browser request. */
  requestMethod?: string;
  /** XHR/fetch responses emitted while a browser-rendered page was loading. */
  observedResponses?: FetchedResponse[];
}

export interface Fetcher {
  /** Fetch a URL (following redirects). Throws only on network-level failure. */
  fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<FetchedResponse>;
  /** Release optional browser/network resources owned by the fetcher. */
  close?(): Promise<void>;
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
      requestMethod: init.method?.toUpperCase() ?? "GET",
    };
  }
}

export interface CreateFetcherOptions {
  /** Chrome DevTools endpoint (e.g. http://localhost:9222). Reuses the live browser session. */
  cdpUrl?: string;
}

/** Try to build a Playwright-backed fetcher; fall back to HttpFetcher if unavailable.
 * Kept dynamic so the browser dependency is optional at runtime. */
export async function createFetcher(
  extraHeaders: Record<string, string> = {},
  options: CreateFetcherOptions = {},
): Promise<Fetcher> {
  if (options.cdpUrl) {
    const pw = await import("playwright");
    const browser = await pw.chromium.connectOverCDP(options.cdpUrl);
    return new PlaywrightFetcher(browser, extraHeaders, { ownsBrowser: false });
  }
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
interface PwBrowserContextLike {
  newPage(opts?: unknown): Promise<PwPageLike>;
}
interface PwBrowserLike {
  newPage(opts?: unknown): Promise<PwPageLike>;
  close(): Promise<void>;
  disconnect?(): void;
  contexts?(): PwBrowserContextLike[];
}
interface PwRequestLike {
  method(): string;
  resourceType(): string;
  frame(): { url(): string };
  headers(): Record<string, string>;
}
interface PwResponseLike {
  url(): string;
  status(): number;
  headers(): Record<string, string>;
  request(): PwRequestLike;
  text(): Promise<string>;
}
interface PwPageLike {
  goto(url: string, opts?: unknown): Promise<PwResponseLike | null>;
  content(): Promise<string>;
  waitForTimeout(timeout: number): Promise<void>;
  on(event: string, cb: (arg: unknown) => void): void;
  close(): Promise<void>;
}

export class PlaywrightFetcher implements Fetcher {
  constructor(
    private readonly browser: PwBrowserLike,
    private readonly extraHeaders: Record<string, string> = {},
    private readonly options: { ownsBrowser?: boolean } = {},
  ) {}

  async fetch(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<FetchedResponse> {
    const method = init.method?.toUpperCase() ?? "GET";
    if (method !== "GET" || init.body !== undefined) {
      return new HttpFetcher(this.extraHeaders).fetch(url, init);
    }

    const extraHTTPHeaders = { ...this.extraHeaders, ...(init.headers ?? {}) };
    const page = await this.openPage(extraHTTPHeaders);
    const pendingResponses: Array<Promise<FetchedResponse | null>> = [];
    page.on("response", (raw) => {
      const response = raw as PwResponseLike;
      const request = response.request();
      if (!["fetch", "xhr"].includes(request.resourceType())) return;
      const requestHeaders = request.headers();
      const initiatorUrl =
        requestHeaders["referer"] ?? requestHeaders["origin"] ?? request.frame().url();
      if (!isTargetPageRequest(initiatorUrl, url)) return;
      if (!isRelatedService(response.url(), url)) return;

      const headers = response.headers();
      const contentType = headers["content-type"] ?? "";
      if (!isApiResponse(response.url(), contentType)) return;

      pendingResponses.push(
        response
          .text()
          .catch(() => "")
          .then((body) => ({
            url: response.url(),
            status: response.status(),
            headers,
            body,
            contentType,
            requestMethod: request.method().toUpperCase(),
          })),
      );
    });
    try {
      // `networkidle` is unreliable on SPAs that poll/stream (it may never settle),
      // and API calls fire during navigation. Wait for the document, then settle for a
      // fixed window so client-side XHR/fetch traffic is observed.
      const resp = await page.goto(url, { waitUntil: "domcontentloaded" });
      const settleMs = browserSettleMs();
      if (settleMs > 0 && (resp?.headers()["content-type"] ?? "").includes("text/html")) {
        await page.waitForTimeout(settleMs);
      }
      const body = await page.content();
      const status = resp?.status() ?? 0;
      const headers = resp?.headers() ?? {};
      const observedResponses = (await Promise.all(pendingResponses)).filter(
        (response): response is FetchedResponse => response !== null,
      );
      return {
        url: resp?.url() ?? url,
        status,
        headers,
        body,
        contentType: headers["content-type"] ?? "text/html",
        requestMethod: "GET",
        observedResponses,
      };
    } finally {
      await page.close();
    }
  }

  async close(): Promise<void> {
    if (this.options.ownsBrowser === false) {
      this.browser.disconnect?.();
      return;
    }
    await this.browser.close();
  }

  /** Prefer an existing context so a CDP-attached profile keeps its cookies. */
  private async openPage(extraHTTPHeaders: Record<string, string>): Promise<PwPageLike> {
    const existing = this.browser.contexts?.() ?? [];
    if (existing.length > 0) {
      return existing[0].newPage({ extraHTTPHeaders });
    }
    return this.browser.newPage({ extraHTTPHeaders });
  }
}

function isApiResponse(url: string, contentType: string): boolean {
  return (
    contentType.includes("application/json") ||
    contentType.includes("application/graphql") ||
    /(?:\/api\/|\/graphql(?:[/?#]|$))/i.test(url)
  );
}

function isTargetPageRequest(frameUrl: string, targetUrl: string): boolean {
  // Many SPAs issue XHR/fetch without a Referer/Origin header, and the observed
  // response may not expose a usable initiator frame URL. When the initiator is
  // unknown, do not reject — the isRelatedService() domain-family check still
  // constrains capture to the target's own services. Only reject when we have a
  // concrete, cross-site initiator hostname.
  if (!frameUrl) return true;
  try {
    return new URL(frameUrl).hostname === new URL(targetUrl).hostname;
  } catch {
    return true;
  }
}

function isRelatedService(responseUrl: string, targetUrl: string): boolean {
  try {
    const targetHost = new URL(targetUrl).hostname;
    const responseHost = new URL(responseUrl).hostname;
    const labels = targetHost.split(".");
    const serviceBoundary = labels.length >= 3 ? labels.slice(1).join(".") : targetHost;
    return responseHost === serviceBoundary || responseHost.endsWith(`.${serviceBoundary}`);
  } catch {
    return false;
  }
}

function browserSettleMs(): number {
  const configured = Number(process.env.WRAPPER_BROWSER_SETTLE_MS ?? "5000");
  return Number.isFinite(configured) && configured >= 0 ? configured : 5000;
}
