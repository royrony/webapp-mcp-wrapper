// T047: human- and machine-readable report rendering (FR-008).
// T051 (US4) extends the human view with new/removed counts.

import type { ExtractionReport } from "../models/extraction-report.js";

/** Render a human-readable summary of an ExtractionReport. */
export function renderReportText(report: ExtractionReport): string {
  const c = report.counts;
  const lines: string[] = [];
  lines.push(`Extraction Report (run ${report.runId})`);
  lines.push(`  Target: ${report.webappTargetId}`);
  lines.push(
    `  Discovered ${c.discovered} | mapped ${c.mapped} | skipped ${c.skipped} | inaccessible ${c.inaccessible}`,
  );
  if (c.newSinceLastRun || c.removedSinceLastRun) {
    lines.push(`  Since last run: +${c.newSinceLastRun} new, -${c.removedSinceLastRun} removed`);
  }
  lines.push("");

  const mapped = report.items.filter((i) => i.mappingStatus === "mapped");
  const skipped = report.items.filter((i) => i.mappingStatus === "skipped");
  const inaccessible = report.items.filter((i) => i.mappingStatus === "inaccessible");

  if (mapped.length) {
    lines.push("Mapped:");
    for (const i of mapped) {
      lines.push(`  [${i.mutating ? "MUTATING" : "read-only"}] ${i.name} (${i.identityKey})`);
    }
  }
  if (skipped.length) {
    lines.push("Skipped:");
    for (const i of skipped) {
      lines.push(`  ${i.name} (${i.identityKey}) — ${i.mappingStatusReason ?? "no reason"}`);
    }
  }
  if (inaccessible.length) {
    lines.push("Inaccessible:");
    for (const i of inaccessible) {
      lines.push(`  ${i.name} (${i.identityKey}) — ${i.mappingStatusReason ?? "no reason"}`);
    }
  }
  if (report.inaccessibleAreas.length) {
    lines.push("Inaccessible areas:");
    for (const a of report.inaccessibleAreas) {
      lines.push(`  ${a.path} — ${a.reason}`);
    }
  }
  return lines.join("\n");
}
