// Shared path/id helpers for CLI commands.
import path from "node:path";

import { domainBoundaryOf } from "../extractor/robots-policy.js";

/** Stable webappTargetId derived from the registrable domain (FR-010). */
export function webappTargetId(rootUrl: string): string {
  return domainBoundaryOf(rootUrl).replace(/[^a-zA-Z0-9.-]/g, "_");
}

/** Default output directory for a target when --out is not supplied. */
export function defaultOutDir(rootUrl: string): string {
  return path.join("./mcp-wrapper-out", webappTargetId(rootUrl));
}
