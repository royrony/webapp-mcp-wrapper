// T030: `extract` CLI command — assembles the pipeline into a persisted ExtractionReport
// (FR-001, FR-009). T048 (US3) adds --auth-session.

import { promises as fs } from "node:fs";
import path from "node:path";

import { validateContract } from "../generator/validate-contract.js";
import { createFetcher } from "../extractor/fetcher.js";
import { runExtraction } from "../extractor/pipeline.js";
import { domainBoundaryOf } from "../extractor/robots-policy.js";
import { RunStore } from "../report/run-store.js";
import { renderReportText } from "../report/render-report.js";
import { diffAgainstPrior } from "../report/diff-runs.js";
import { EXIT, CliError } from "./exit-codes.js";
import { defaultOutDir, webappTargetId } from "./paths.js";

export interface ExtractOptions {
  authSession?: string;
  /** Chrome DevTools URL; reuse a live logged-in browser for any webapp. */
  cdpUrl?: string;
  maxPages?: number;
  out?: string;
  json?: boolean;
  /** Internal: compute new/removed diff against the prior run (used by refresh). */
  diff?: boolean;
}

export async function extractCommand(rootUrl: string, opts: ExtractOptions): Promise<number> {
  const outDir = opts.out ?? defaultOutDir(rootUrl);
  const targetId = webappTargetId(rootUrl);
  const domainBoundary = domainBoundaryOf(rootUrl);

  let extraHeaders: Record<string, string> = {};
  const authSession = Boolean(opts.authSession || opts.cdpUrl);
  if (opts.authSession) {
    extraHeaders = await loadAuthSession(opts.authSession);
  }
  if (opts.cdpUrl && process.env.WRAPPER_FORCE_HTTP_FETCHER === "1") {
    throw new CliError(
      EXIT.INVALID_ARGS,
      "Cannot use --cdp-url with WRAPPER_FORCE_HTTP_FETCHER=1; CDP needs a live browser.",
    );
  }

  const fetcher = await createFetcher(extraHeaders, { cdpUrl: opts.cdpUrl });
  let result: Awaited<ReturnType<typeof runExtraction>>;
  try {
    result = await runExtraction({
      rootUrl,
      domainBoundary,
      webappTargetId: targetId,
      maxPages: opts.maxPages ?? 50,
      fetcher,
      authSession,
    });
  } finally {
    await fetcher.close?.();
  }

  if (!result.reachable) {
    const msg = `Unreachable URL: ${rootUrl}${result.error ? ` (${result.error})` : ""}`;
    throw new CliError(EXIT.UNREACHABLE_URL, msg);
  }

  const store = await RunStore.open(outDir, result.target);

  // Refresh diff (US4): fill new/removed counts against the prior run.
  if (opts.diff) {
    const prior = store.latestRun();
    const diff = diffAgainstPrior(result.functionality, prior?.functionality ?? []);
    result.report.counts.newSinceLastRun = diff.newCount;
    result.report.counts.removedSinceLastRun = diff.removedCount;
    for (const removed of diff.removedItems) {
      result.report.items.push({
        identityKey: removed.identityKey,
        name: removed.name,
        kind: removed.kind,
        httpMethod: removed.httpMethod,
        mutating: removed.mutating,
        mappingStatus: "inaccessible",
        mappingStatusReason: "No longer present since the last run",
      });
    }
  }

  // Validate the report against its contract before writing (T017).
  validateContract("extraction-report", result.report);

  await store.saveRun(result.report, result.functionality);
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, "extraction-report.json"),
    JSON.stringify(result.report, null, 2),
    "utf8",
  );

  if (opts.json) {
    process.stdout.write(JSON.stringify(result.report, null, 2) + "\n");
  } else {
    process.stdout.write(renderReportText(result.report) + "\n");
    process.stdout.write(`\nReport written to ${path.join(outDir, "extraction-report.json")}\n`);
  }
  return EXIT.SUCCESS;
}

/** Load an auth session file (JSON with headers or a cookie string) into request headers. */
async function loadAuthSession(file: string): Promise<Record<string, string>> {
  const raw = await fs.readFile(file, "utf8");
  try {
    const parsed = JSON.parse(raw);
    if (parsed.headers && typeof parsed.headers === "object") return parsed.headers;
    if (parsed.cookie) return { cookie: String(parsed.cookie) };
    if (parsed.authorization) return { authorization: String(parsed.authorization) };
  } catch {
    // treat the whole file as a cookie header value
    return { cookie: raw.trim() };
  }
  return {};
}
