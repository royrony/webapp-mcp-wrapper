// T019: robots.txt fetch/parse and domain-boundary guard (FR-013).

import type { RobotsPolicy } from "../models/webapp-target.js";

/** Parse a robots.txt body into the disallow rules that apply to any user agent.
 * Simplified but correct for the common `User-agent: *` block plus wildcard groups. */
export function parseRobots(raw: string): RobotsPolicy {
  const disallow: string[] = [];
  let inStarGroup = false;
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [field, ...rest] = line.split(":");
    const key = field.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") {
      inStarGroup = value === "*";
    } else if (key === "disallow" && inStarGroup && value) {
      disallow.push(value);
    }
  }
  return { disallow, raw };
}

/** Extract the registrable-domain boundary from a URL (host without a leading www.). */
export function domainBoundaryOf(rootUrl: string): string {
  const host = new URL(rootUrl).hostname;
  return host.replace(/^www\./, "");
}

/** Is `candidateUrl` inside the target's registrable-domain boundary? */
export function isWithinDomain(candidateUrl: string, domainBoundary: string): boolean {
  let host: string;
  try {
    host = new URL(candidateUrl).hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
  return host === domainBoundary || host.endsWith(`.${domainBoundary}`);
}

/** Is `pathname` disallowed by the robots policy? (prefix match, per robots.txt semantics) */
export function isDisallowed(pathname: string, policy: RobotsPolicy): boolean {
  return policy.disallow.some((rule) => pathname.startsWith(rule));
}

/** Combined crawl-permission check: in-domain AND not robots-disallowed. */
export function mayCrawl(url: string, domainBoundary: string, policy: RobotsPolicy): boolean {
  if (!isWithinDomain(url, domainBoundary)) return false;
  const pathname = new URL(url).pathname;
  return !isDisallowed(pathname, policy);
}
