// T010: WebappTarget — the discovery target and its crawl policy (data-model.md).

export type AuthMode = "none" | "oauth";

export interface RobotsPolicy {
  /** Path prefixes disallowed by robots.txt for our user agent. */
  disallow: string[];
  /** Raw robots.txt body, retained for auditability. */
  raw: string;
}

export interface WebappTarget {
  /** Stable id derived from the registrable domain; reused across re-runs (FR-010). */
  id: string;
  /** User-supplied entry point; must be reachable (FR-009). */
  rootUrl: string;
  /** Registrable domain crawling is restricted to. */
  domainBoundary: string;
  /** Whether an authenticated crawl session was supplied for discovery (FR-011). */
  authMode: AuthMode;
  robotsPolicy: RobotsPolicy;
  createdAt: string;
  lastExtractedAt: string;
}
