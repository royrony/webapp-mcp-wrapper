import { describe, expect, it, vi } from "vitest";

import { ApiSniffer } from "../../src/extractor/api-sniffer.js";
import { crawl } from "../../src/extractor/crawler.js";
import {
  PlaywrightFetcher,
  type FetchedResponse,
  type Fetcher,
} from "../../src/extractor/fetcher.js";

function response(
  url: string,
  status: number,
  contentType: string,
  body: string,
  method = "GET",
  frameUrl = "https://app.example.test/",
  referer = frameUrl,
) {
  return {
    url: () => url,
    status: () => status,
    headers: () => ({ "content-type": contentType }),
    request: () => ({
      method: () => method,
      resourceType: () => "fetch",
      frame: () => ({ url: () => frameUrl }),
      headers: () => ({ referer }),
    }),
    text: async () => body,
  };
}

describe("browser extraction", () => {
  it("captures JSON XHR responses with their request methods and closes resources", async () => {
    const apiResponse = response(
      "https://api.example.test/api/widgets",
      200,
      "application/json",
      '{"items":[]}',
      "POST",
    );
    const navigationResponse = response(
      "https://app.example.test/",
      200,
      "text/html",
      "<html></html>",
    );
    const identityProviderResponse = response(
      "https://accounts.identity.test/api/signin",
      200,
      "application/json",
      '{"flow":"signin"}',
      "POST",
      "https://accounts.identity.test/signin",
    );
    let onResponse: ((value: unknown) => void) | undefined;
    const closePage = vi.fn(async () => undefined);
    const closeBrowser = vi.fn(async () => undefined);
    const contextNewPage = vi.fn(async () => ({
      on: (_event: string, callback: (value: unknown) => void) => {
        onResponse = callback;
      },
      goto: async () => navigationResponse,
      waitForTimeout: async () => {
        onResponse?.(apiResponse);
        onResponse?.(identityProviderResponse);
      },
      content: async () => "<html><body>Loaded</body></html>",
      close: closePage,
    }));
    const browser = {
      newPage: vi.fn(async () => {
        throw new Error("attached browsers must open pages on an existing context");
      }),
      contexts: () => [{ newPage: contextNewPage }],
      close: closeBrowser,
      disconnect: vi.fn(),
    };

    const fetcher = new PlaywrightFetcher(browser as never, { authorization: "Bearer test" }, { ownsBrowser: false });
    const result = await fetcher.fetch("https://app.example.test/");
    await fetcher.close();

    expect(contextNewPage).toHaveBeenCalledWith({
      extraHTTPHeaders: { authorization: "Bearer test" },
    });
    expect(browser.newPage).not.toHaveBeenCalled();
    expect(result.observedResponses).toEqual([
      expect.objectContaining({
        url: "https://api.example.test/api/widgets",
        status: 200,
        requestMethod: "POST",
        body: '{"items":[]}',
      }),
    ]);
    expect(closePage).toHaveBeenCalledOnce();
    expect(closeBrowser).not.toHaveBeenCalled();
    expect(browser.disconnect).toHaveBeenCalledOnce();
  });

  it("maps successful browser API traffic and records API auth gates", async () => {
    const root: FetchedResponse = {
      url: "https://app.example.test/",
      status: 200,
      headers: { "content-type": "text/html" },
      contentType: "text/html",
      body: "<html><body>SPA</body></html>",
      requestMethod: "GET",
      observedResponses: [
        {
          url: "https://api.example.test/api/widgets",
          status: 200,
          headers: { "content-type": "application/json" },
          contentType: "application/json",
          body: '{"items":[]}',
          requestMethod: "POST",
        },
        {
          url: "https://api.example.test/api/me",
          status: 401,
          headers: { "content-type": "application/json" },
          contentType: "application/json",
          body: '{"message":"Unauthorized"}',
          requestMethod: "GET",
        },
      ],
    };
    const fetcher: Fetcher = { fetch: vi.fn(async () => root) };
    const sniffer = new ApiSniffer();

    const result = await crawl("https://app.example.test/", fetcher, {
      domainBoundary: "app.example.test",
      robotsPolicy: { disallow: [], raw: "" },
      maxPages: 1,
      onResponse: (res) => sniffer.observe(res),
    });

    expect(sniffer.all()).toEqual([
      expect.objectContaining({
        url: "https://api.example.test/api/widgets",
        method: "POST",
      }),
    ]);
    expect(result.authGated).toEqual([
      { url: "https://api.example.test/api/me", status: 401 },
    ]);
  });

  it("keeps target API traffic but does not parse forms after an external redirect", async () => {
    const fetch = vi.fn();
    const initialResponse: FetchedResponse = {
      url: "https://accounts.identity.test/signin",
      status: 200,
      headers: { "content-type": "text/html" },
      contentType: "text/html",
      body: '<form action="/v3/signin/identifier" method="post"></form>',
      requestMethod: "GET",
      observedResponses: [
        {
          url: "https://api.example.test/api/me",
          status: 401,
          headers: { "content-type": "application/json" },
          contentType: "application/json",
          body: '{"message":"Unauthorized"}',
          requestMethod: "GET",
        },
      ],
    };

    const result = await crawl(
      "https://app.example.test/",
      { fetch },
      {
        domainBoundary: "app.example.test",
        robotsPolicy: { disallow: [], raw: "" },
        maxPages: 1,
        initialResponse,
      },
    );

    expect(fetch).not.toHaveBeenCalled();
    expect(result.pages).toHaveLength(0);
    expect(result.authGated).toEqual([
      { url: "https://api.example.test/api/me", status: 401 },
    ]);
    expect(result.skipped).toEqual([
      {
        url: "https://accounts.identity.test/signin",
        reason: "redirected outside domain boundary",
      },
    ]);
  });
});
