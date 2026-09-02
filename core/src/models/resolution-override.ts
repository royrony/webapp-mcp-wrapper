// T015: ResolutionOverride — matches contracts/resolution-override.schema.json (an array of these).

import type { FunctionalityParameter } from "./discovered-functionality.js";

export interface OverrideVerification {
  attempted: boolean;
  succeeded: boolean;
  calledAt?: string;
  responseSummary?: string;
}

export interface ResolutionOverride {
  /** FK to the DiscoveredFunctionality item being corrected. */
  identityKey: string;
  suppliedBy: "agent" | "human";
  proposedFix: {
    parameters?: FunctionalityParameter[];
    description?: string;
    outputSchema?: Record<string, unknown>;
  };
  /** Populated by apply-overrides after a real call — never supplied by the agent. */
  verification?: OverrideVerification;
  /** MUST only be set once verification.succeeded === true (FR-020). */
  appliedAt?: string | null;
}
