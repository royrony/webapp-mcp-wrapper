// T013: ExtractionReport — matches contracts/extraction-report.schema.json.

import type { DiscoveredFunctionality } from "./discovered-functionality.js";

export interface ExtractionCounts {
  discovered: number;
  mapped: number;
  skipped: number;
  inaccessible: number;
  newSinceLastRun: number;
  removedSinceLastRun: number;
}

export interface InaccessibleArea {
  path: string;
  reason: string;
}

/** The per-item shape actually serialized into the report (a projection of DiscoveredFunctionality). */
export interface ReportItem {
  identityKey: string;
  name: string;
  kind: "api-endpoint" | "ui-action";
  httpMethod?: string | null;
  mutating: boolean;
  mappingStatus: "mapped" | "skipped" | "inaccessible";
  mappingStatusReason?: string | null;
}

export interface ExtractionReport {
  runId: string;
  webappTargetId: string;
  startedAt: string;
  finishedAt: string;
  counts: ExtractionCounts;
  items: ReportItem[];
  inaccessibleAreas: InaccessibleArea[];
}

/** Project a full DiscoveredFunctionality into the report's item shape. */
export function toReportItem(f: DiscoveredFunctionality): ReportItem {
  return {
    identityKey: f.identityKey,
    name: f.name,
    kind: f.kind,
    httpMethod: f.httpMethod,
    mutating: f.mutating,
    mappingStatus: f.mappingStatus,
    mappingStatusReason: f.mappingStatusReason,
  };
}
