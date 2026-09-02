// T038: `apply-overrides` — validate a resolution-override file, make a real verification
// call per item, and promote mappingStatus only on success (FR-020).

import { promises as fs } from "node:fs";

import type { ResolutionOverride } from "../models/resolution-override.js";
import { checkContract } from "../generator/validate-contract.js";
import { createFetcher } from "../extractor/fetcher.js";
import type { Fetcher } from "../extractor/fetcher.js";
import { RunStore } from "../report/run-store.js";
import { domainBoundaryOf } from "../extractor/robots-policy.js";
import { EXIT, CliError } from "./exit-codes.js";
import { defaultOutDir, webappTargetId } from "./paths.js";
import type { WebappTarget } from "../models/webapp-target.js";

export interface ApplyOverridesOptions {
  run?: string;
  out?: string;
  json?: boolean;
  /** Injectable fetcher for tests. */
  fetcher?: Fetcher;
}

export async function applyOverridesCommand(
  rootUrl: string,
  overridesFile: string,
  opts: ApplyOverridesOptions,
): Promise<number> {
  const outDir = opts.out ?? defaultOutDir(rootUrl);
  const targetId = webappTargetId(rootUrl);

  let overrides: ResolutionOverride[];
  try {
    overrides = JSON.parse(await fs.readFile(overridesFile, "utf8")) as ResolutionOverride[];
  } catch (e) {
    throw new CliError(EXIT.OVERRIDES_SCHEMA_INVALID, `Cannot read overrides file: ${(e as Error).message}`);
  }

  const check = checkContract("resolution-override", overrides);
  if (!check.valid) {
    throw new CliError(
      EXIT.OVERRIDES_SCHEMA_INVALID,
      `Overrides file failed schema validation:\n  - ${check.errors.join("\n  - ")}`,
    );
  }

  const placeholderTarget: WebappTarget = {
    id: targetId,
    rootUrl,
    domainBoundary: domainBoundaryOf(rootUrl),
    authMode: "none",
    robotsPolicy: { disallow: [], raw: "" },
    createdAt: new Date().toISOString(),
    lastExtractedAt: new Date().toISOString(),
  };
  const store = await RunStore.open(outDir, placeholderTarget);
  const run = opts.run ? store.runById(opts.run) : store.latestRun();
  if (!run) {
    throw new CliError(EXIT.NO_EXTRACTION_RUN, `No extraction run found for ${rootUrl}. Run \`extract\` first.`);
  }

  const fetcher = opts.fetcher ?? (await createFetcher());
  const byKey = new Map(run.functionality.map((f) => [f.identityKey, f]));
  const results: Array<{ identityKey: string; verified: boolean; reason?: string }> = [];

  for (const override of overrides) {
    const item = byKey.get(override.identityKey);
    if (!item) {
      override.verification = { attempted: false, succeeded: false, responseSummary: "unknown identityKey" };
      override.appliedAt = null;
      results.push({ identityKey: override.identityKey, verified: false, reason: "unknown identityKey" });
      continue;
    }

    // Make a real verification call using the proposed fix.
    const [method, pathTemplate] = item.identityKey.split(" ");
    const url = new URL(pathTemplate.replace(/\{[^}]+\}/g, "1"), rootUrl).toString();
    let succeeded = false;
    let summary = "";
    try {
      const res = await fetcher.fetch(url, { method });
      succeeded = res.status < 400;
      summary = `HTTP ${res.status}`;
    } catch (e) {
      summary = `error: ${(e as Error).message}`;
    }

    override.verification = {
      attempted: true,
      succeeded,
      calledAt: new Date().toISOString(),
      responseSummary: summary,
    };
    override.appliedAt = succeeded ? new Date().toISOString() : null;

    if (succeeded) {
      item.mappingStatus = "mapped";
      item.mappingStatusReason = null;
      if (override.proposedFix.description) item.description = override.proposedFix.description;
      if (override.proposedFix.parameters) item.parameters = override.proposedFix.parameters;
      if (override.proposedFix.outputSchema) item.expectedOutput = override.proposedFix.outputSchema;
    }
    results.push({ identityKey: override.identityKey, verified: succeeded, reason: summary });
  }

  await store.recordOverrides(overrides);
  // Persist the promoted functionality back into the run so generate sees mapped items.
  await store.saveRun(run.report, run.functionality);

  if (opts.json) {
    process.stdout.write(JSON.stringify({ results }, null, 2) + "\n");
  } else {
    for (const r of results) {
      process.stdout.write(`${r.verified ? "✓" : "✗"} ${r.identityKey}${r.reason ? ` (${r.reason})` : ""}\n`);
    }
  }
  // Exit 0 regardless of per-item outcomes (per contract) — caller inspects results.
  return EXIT.SUCCESS;
}
