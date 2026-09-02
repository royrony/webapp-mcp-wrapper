// T045: inaccessible-area tracking when auth-gated paths are hit without credentials (FR-011).
// Recorded into ExtractionReport.inaccessibleAreas rather than silently omitted (Principle III).

import type { InaccessibleArea } from "../models/extraction-report.js";

export interface AuthGateHit {
  url: string;
  status: number;
}

const AUTH_GATE_STATUSES = new Set([401, 403]);

/** Is an HTTP status an authentication/authorization gate? */
export function isAuthGate(status: number): boolean {
  return AUTH_GATE_STATUSES.has(status);
}

/** Convert observed auth-gate hits into ExtractionReport inaccessibleAreas entries. */
export function toInaccessibleAreas(hits: AuthGateHit[]): InaccessibleArea[] {
  const seen = new Set<string>();
  const areas: InaccessibleArea[] = [];
  for (const hit of hits) {
    let pathname: string;
    try {
      pathname = new URL(hit.url).pathname;
    } catch {
      pathname = hit.url;
    }
    if (seen.has(pathname)) continue;
    seen.add(pathname);
    areas.push({
      path: pathname,
      reason: `Authentication required (HTTP ${hit.status}); supply --cdp-url or --auth-session to include this area.`,
    });
  }
  return areas;
}
