// Extraction pipeline assembly: crawl -> sniff APIs + discover specs -> describe -> dedupe.
// Shared by the `extract` and `refresh` CLI commands.

import { randomUUID } from "node:crypto";

import type { DiscoveredFunctionality } from "../models/discovered-functionality.js";
import type { ExtractionReport, InaccessibleArea } from "../models/extraction-report.js";
import type { RobotsPolicy, WebappTarget } from "../models/webapp-target.js";
import { toReportItem } from "../models/extraction-report.js";

import { ApiSniffer } from "./api-sniffer.js";
import { toInaccessibleAreas } from "./auth-gate.js";
import { crawl } from "./crawler.js";
import { dedupe } from "./dedupe.js";
import { describeAll } from "./describe.js";
import type { Fetcher } from "./fetcher.js";
import { parseRobots } from "./robots-policy.js";
import { discoverSpecs } from "./spec-discovery.js";
import { validateTarget } from "./validate-target.js";

export interface ExtractParams {
  rootUrl: string;
  domainBoundary: string;
  webappTargetId: string;
  maxPages: number;
  fetcher: Fetcher;
  /** Whether an authenticated session was supplied (affects authMode). */
  authSession?: boolean;
}

export interface ExtractOutput {
  target: WebappTarget;
  report: ExtractionReport;
  functionality: DiscoveredFunctionality[];
  reachable: boolean;
  error?: string;
}

async function fetchRobots(rootUrl: string, fetcher: Fetcher): Promise<RobotsPolicy> {
  try {
    const robotsUrl = new URL("/robots.txt", rootUrl).toString();
    const res = await fetcher.fetch(robotsUrl);
    if (res.status === 200) return parseRobots(res.body);
  } catch {
    /* no robots.txt — allow all */
  }
  return { disallow: [], raw: "" };
}

export async function runExtraction(params: ExtractParams): Promise<ExtractOutput> {
  const now = new Date().toISOString();
  const runId = `run-${randomUUID()}`;

  const reachability = await validateTarget(params.rootUrl, params.fetcher);
  const robotsPolicy = await fetchRobots(params.rootUrl, params.fetcher);
  const target: WebappTarget = {
    id: params.webappTargetId,
    rootUrl: params.rootUrl,
    domainBoundary: params.domainBoundary,
    authMode: params.authSession ? "oauth" : "none",
    robotsPolicy,
    createdAt: now,
    lastExtractedAt: now,
  };

  if (!reachability.reachable) {
    const report: ExtractionReport = {
      runId,
      webappTargetId: params.webappTargetId,
      startedAt: now,
      finishedAt: new Date().toISOString(),
      counts: { discovered: 0, mapped: 0, skipped: 0, inaccessible: 0, newSinceLastRun: 0, removedSinceLastRun: 0 },
      items: [],
      inaccessibleAreas: [],
    };
    return { target, report, functionality: [], reachable: false, error: reachability.error };
  }

  const sniffer = new ApiSniffer();
  const crawlResult = await crawl(params.rootUrl, params.fetcher, {
    domainBoundary: params.domainBoundary,
    robotsPolicy,
    maxPages: params.maxPages,
    onResponse: (res) => sniffer.observe(res),
  });

  // Probe API-like links (JSON endpoints reachable from pages) so GETs get captured.
  for (const page of crawlResult.pages) {
    for (const form of page.forms) sniffer.observeForm(form);
    for (const link of page.links) {
      if (/\/api\//.test(link)) {
        try {
          const res = await params.fetcher.fetch(link);
          sniffer.observe(res, "GET");
        } catch {
          /* ignore */
        }
      }
    }
  }

  const specResult = await discoverSpecs(params.rootUrl, params.fetcher);
  const rawCalls = [...sniffer.all(), ...specResult.calls];

  const described = describeAll(rawCalls, { runId });
  const functionality = dedupe(described);

  // Auth-gated areas become inaccessible entries (FR-011; auth-gate.ts, T045).
  const inaccessibleAreas: InaccessibleArea[] = toInaccessibleAreas(crawlResult.authGated);

  const counts = countStatuses(functionality, inaccessibleAreas.length);
  const report: ExtractionReport = {
    runId,
    webappTargetId: params.webappTargetId,
    startedAt: now,
    finishedAt: new Date().toISOString(),
    counts,
    items: functionality.map(toReportItem),
    inaccessibleAreas,
  };

  return { target, report, functionality, reachable: true };
}

export function countStatuses(
  functionality: DiscoveredFunctionality[],
  inaccessibleAreaCount = 0,
): ExtractionReport["counts"] {
  const mapped = functionality.filter((f) => f.mappingStatus === "mapped").length;
  const skipped = functionality.filter((f) => f.mappingStatus === "skipped").length;
  const inaccessible =
    functionality.filter((f) => f.mappingStatus === "inaccessible").length + inaccessibleAreaCount;
  return {
    discovered: functionality.length,
    mapped,
    skipped,
    inaccessible,
    newSinceLastRun: 0,
    removedSinceLastRun: 0,
  };
}
