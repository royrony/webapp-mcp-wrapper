// T011: DiscoveredFunctionality — one discovered item and its per-run fate (data-model.md).

export type FunctionalityKind = "api-endpoint" | "ui-action";
export type MappingStatus = "mapped" | "skipped" | "inaccessible";
export type ParameterSource = "query" | "body" | "path" | "form" | "header";

export interface FunctionalityParameter {
  name: string;
  type: string;
  required: boolean;
  source: ParameterSource;
}

export interface DiscoveredFunctionality {
  /** Normalized method+path-template, or DOM-role+label for pure UI actions. Stable across re-runs. */
  identityKey: string;
  name: string;
  description: string;
  kind: FunctionalityKind;
  httpMethod: string | null;
  parameters: FunctionalityParameter[];
  expectedOutput: Record<string, unknown> | null;
  mutating: boolean;
  mappingStatus: MappingStatus;
  /** Required whenever mappingStatus !== "mapped" (FR-008). */
  mappingStatusReason: string | null;
  firstSeenRun: string;
  lastSeenRun: string;
}
