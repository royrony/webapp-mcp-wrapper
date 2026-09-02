// T029: de-duplication using the identity-key utility (FR-004).
// Merges items sharing an identityKey, preferring a mapped item and the richer parameter set.

import type { DiscoveredFunctionality } from "../models/discovered-functionality.js";

export function dedupe(items: DiscoveredFunctionality[]): DiscoveredFunctionality[] {
  const byKey = new Map<string, DiscoveredFunctionality>();
  for (const item of items) {
    const existing = byKey.get(item.identityKey);
    if (!existing) {
      byKey.set(item.identityKey, item);
      continue;
    }
    byKey.set(item.identityKey, mergeItems(existing, item));
  }
  return [...byKey.values()];
}

function mergeItems(a: DiscoveredFunctionality, b: DiscoveredFunctionality): DiscoveredFunctionality {
  // Prefer the mapped one; if both same status, prefer the one with more parameters/output.
  const preferB =
    (a.mappingStatus !== "mapped" && b.mappingStatus === "mapped") ||
    (a.mappingStatus === b.mappingStatus &&
      b.parameters.length + (b.expectedOutput ? 1 : 0) > a.parameters.length + (a.expectedOutput ? 1 : 0));
  const primary = preferB ? b : a;
  const secondary = preferB ? a : b;

  // Union parameters by name.
  const params = new Map(primary.parameters.map((p) => [p.name, p]));
  for (const p of secondary.parameters) if (!params.has(p.name)) params.set(p.name, p);

  return {
    ...primary,
    parameters: [...params.values()],
    expectedOutput: primary.expectedOutput ?? secondary.expectedOutput,
    firstSeenRun:
      a.firstSeenRun < b.firstSeenRun ? a.firstSeenRun : b.firstSeenRun,
    lastSeenRun: a.lastSeenRun > b.lastSeenRun ? a.lastSeenRun : b.lastSeenRun,
  };
}
