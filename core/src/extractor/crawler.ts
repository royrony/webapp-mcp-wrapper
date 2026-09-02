// T025: crawler for pages/links/forms within the domain boundary (FR-002).
// Uses the Fetcher abstraction (Playwright when available, else fetch). Honors the
// robots policy and domain boundary via mayCrawl (T019).

import type { Fetcher, FetchedResponse } from "./fetcher.js";
import type { RobotsPolicy } from "../models/webapp-target.js";
import { isWithinDomain, mayCrawl } from "./robots-policy.js";

export interface DiscoveredForm {
  action: string;
  method: string;
  fields: Array<{ name: string; type: string }>;
  /** Nearest submit-button label / form heading, for classification hints. */
  label: string;
}

export interface CrawledPage {
  url: string;
  status: number;
  links: string[];
  forms: DiscoveredForm[];
}

export interface CrawlResult {
  pages: CrawledPage[];
  /** URLs that were skipped because robots/domain rules disallowed them. */
  skipped: Array<{ url: string; reason: string }>;
  /** Pages that returned an auth-gate status (401/403). */
  authGated: Array<{ url: string; status: number }>;
}

const HREF_RE = /<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi;
const FORM_RE = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
const INPUT_RE = /<(input|select|textarea)\b([^>]*)>/gi;
const ATTR = (attrs: string, name: string): string | null => {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(attrs);
  return m ? m[1] : null;
};

export function extractLinks(baseUrl: string, html: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  HREF_RE.lastIndex = 0;
  while ((m = HREF_RE.exec(html)) !== null) {
    try {
      out.add(new URL(m[1], baseUrl).toString());
    } catch {
      /* ignore malformed hrefs */
    }
  }
  return [...out];
}

export function extractForms(baseUrl: string, html: string): DiscoveredForm[] {
  const forms: DiscoveredForm[] = [];
  let fm: RegExpExecArray | null;
  FORM_RE.lastIndex = 0;
  while ((fm = FORM_RE.exec(html)) !== null) {
    const attrs = fm[1];
    const inner = fm[2];
    const action = ATTR(attrs, "action") ?? baseUrl;
    const method = (ATTR(attrs, "method") ?? "GET").toUpperCase();
    const fields: Array<{ name: string; type: string }> = [];
    let im: RegExpExecArray | null;
    INPUT_RE.lastIndex = 0;
    while ((im = INPUT_RE.exec(inner)) !== null) {
      const iattrs = im[2];
      const name = ATTR(iattrs, "name");
      if (!name) continue;
      fields.push({ name, type: ATTR(iattrs, "type") ?? "text" });
    }
    const buttonLabel = /<button[^>]*>([\s\S]*?)<\/button>/i.exec(inner)?.[1]?.trim() ?? "";
    let resolvedAction: string;
    try {
      resolvedAction = new URL(action, baseUrl).toString();
    } catch {
      resolvedAction = action;
    }
    forms.push({ action: resolvedAction, method, fields, label: buttonLabel });
  }
  return forms;
}

export interface CrawlOptions {
  domainBoundary: string;
  robotsPolicy: RobotsPolicy;
  maxPages: number;
  /** Reuse the root response already fetched during reachability validation. */
  initialResponse?: FetchedResponse;
  /** Optional callback fired for every fetched response (used by the api-sniffer). */
  onResponse?: (res: FetchedResponse) => void;
}

/** BFS crawl from rootUrl, honoring the domain boundary and robots rules. */
export async function crawl(
  rootUrl: string,
  fetcher: Fetcher,
  opts: CrawlOptions,
): Promise<CrawlResult> {
  const pages: CrawledPage[] = [];
  const skipped: CrawlResult["skipped"] = [];
  const authGated: CrawlResult["authGated"] = [];
  const authGateKeys = new Set<string>();
  const seen = new Set<string>();
  const queue: string[] = [rootUrl];

  while (queue.length > 0 && pages.length < opts.maxPages) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);

    if (!mayCrawl(url, opts.domainBoundary, opts.robotsPolicy)) {
      skipped.push({ url, reason: "robots.txt or domain boundary" });
      continue;
    }

    let res: FetchedResponse;
    try {
      res =
        url === rootUrl && opts.initialResponse
          ? opts.initialResponse
          : await fetcher.fetch(url);
    } catch (e) {
      skipped.push({ url, reason: `fetch error: ${(e as Error).message}` });
      continue;
    }

    for (const response of [res, ...(res.observedResponses ?? [])]) {
      if (response.status === 401 || response.status === 403) {
        const key = `${response.status} ${response.url}`;
        if (!authGateKeys.has(key)) {
          authGateKeys.add(key);
          authGated.push({ url: response.url, status: response.status });
        }
      } else {
        opts.onResponse?.(response);
      }
    }

    if (res.status === 401 || res.status === 403) {
      continue;
    }
    if (res.status >= 400) {
      continue;
    }
    if (!isWithinDomain(res.url, opts.domainBoundary)) {
      skipped.push({ url: res.url, reason: "redirected outside domain boundary" });
      continue;
    }

    const isHtml = res.contentType.includes("text/html") || res.body.trimStart().startsWith("<");
    const links = isHtml ? extractLinks(res.url, res.body) : [];
    const forms = isHtml ? extractForms(res.url, res.body) : [];
    pages.push({ url: res.url, status: res.status, links, forms });

    for (const link of links) {
      if (!seen.has(link) && mayCrawl(link, opts.domainBoundary, opts.robotsPolicy)) {
        queue.push(link);
      }
    }
  }

  return { pages, skipped, authGated };
}
