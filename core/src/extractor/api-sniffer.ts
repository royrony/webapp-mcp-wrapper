// T026: capture REST/GraphQL API calls (FR-002).
//
// With the Playwright fetcher, network interception captures XHR/fetch calls a page
// makes. With the HTTP fetcher, we detect API endpoints two ways: (1) responses whose
// content-type is JSON (or GraphQL), observed during the crawl, and (2) form actions,
// which name a mutating endpoint directly. Both feed the same RawApiCall shape so the
// downstream describe/dedupe stages are engine-independent.

import type { FetchedResponse } from "./fetcher.js";
import type { DiscoveredForm } from "./crawler.js";

export interface RawApiCall {
  url: string;
  method: string;
  /** Best-effort request parameter names by source. */
  params: Array<{ name: string; type: string; required: boolean; source: "query" | "body" | "form" }>;
  /** Parsed response body sample, when JSON. */
  responseSample: Record<string, unknown> | null;
  contentType: string;
}

function parseQueryParams(url: string): RawApiCall["params"] {
  try {
    const u = new URL(url);
    return [...u.searchParams.keys()].map((name) => ({
      name,
      type: "string",
      required: false,
      source: "query" as const,
    }));
  } catch {
    return [];
  }
}

function looksLikeApi(res: FetchedResponse): boolean {
  if (res.contentType.includes("application/json")) return true;
  if (res.contentType.includes("application/graphql")) return true;
  const trimmed = res.body.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(res.body);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Collects API calls observed during crawling plus form-action endpoints. */
export class ApiSniffer {
  private readonly calls = new Map<string, RawApiCall>();

  /** Called for each response the crawler fetched. */
  observe(res: FetchedResponse, method = "GET"): void {
    if (!looksLikeApi(res)) return;
    let sample: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(res.body);
      sample = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      sample = null;
    }
    const key = `${method.toUpperCase()} ${res.url}`;
    this.calls.set(key, {
      url: res.url,
      method: method.toUpperCase(),
      params: parseQueryParams(res.url),
      responseSample: sample,
      contentType: res.contentType,
    });
  }

  /** Record a form action as a (usually mutating) API endpoint. */
  observeForm(form: DiscoveredForm): void {
    const key = `${form.method} ${form.action}`;
    this.calls.set(key, {
      url: form.action,
      method: form.method,
      params: form.fields.map((f) => ({
        name: f.name,
        type: f.type === "number" ? "number" : "string",
        required: false,
        source: "form" as const,
      })),
      responseSample: null,
      contentType: "application/x-www-form-urlencoded",
    });
  }

  all(): RawApiCall[] {
    return [...this.calls.values()];
  }
}
