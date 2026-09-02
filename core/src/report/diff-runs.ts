// T050: prior-run lookup and identity-key diffing (new/removed) (FR-010; research.md #9).

import type { DiscoveredFunctionality } from "../models/discovered-functionality.js";

export interface RunDiff {
  newCount: number;
  removedCount: number;
  newItems: DiscoveredFunctionality[];
  removedItems: DiscoveredFunctionality[];
}

/** Diff the current run's functionality against the prior run by identity key. */
export function diffAgainstPrior(
  current: DiscoveredFunctionality[],
  prior: DiscoveredFunctionality[],
): RunDiff {
  const currentKeys = new Set(current.map((f) => f.identityKey));
  const priorKeys = new Set(prior.map((f) => f.identityKey));

  const newItems = current.filter((f) => !priorKeys.has(f.identityKey));
  const removedItems = prior.filter((f) => !currentKeys.has(f.identityKey));

  return {
    newCount: newItems.length,
    removedCount: removedItems.length,
    newItems,
    removedItems,
  };
}
