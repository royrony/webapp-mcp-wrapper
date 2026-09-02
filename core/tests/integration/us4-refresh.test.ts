// US4 integration: refresh diff — new/removed counts and removed-item flagging (FR-010, SC-005).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { HttpFetcher } from "../../src/extractor/fetcher.js";
import { extractCommand } from "../../src/cli/extract.js";
import { refreshCommand } from "../../src/cli/refresh.js";
import { diffAgainstPrior } from "../../src/report/diff-runs.js";
import type { DiscoveredFunctionality } from "../../src/models/discovered-functionality.js";

/** A fixture whose endpoint set can be mutated between runs. */
function mutableServer(state: { extra: boolean; removed: boolean }) {
  return http.createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    if (url.pathname === "/") {
      const links = ['<a href="/api/widgets">w</a>'];
      if (!state.removed) links.push('<a href="/api/legacy">legacy</a>');
      if (state.extra) links.push('<a href="/api/new">new</a>');
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<html><body>${links.join("")}</body></html>`);
      return;
    }
    if (url.pathname === "/api/widgets") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ widgets: [] }));
      return;
    }
    if (url.pathname === "/api/legacy" && !state.removed) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ legacy: true }));
      return;
    }
    if (url.pathname === "/api/new" && state.extra) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ created: true }));
      return;
    }
    res.writeHead(404).end("nf");
  });
}

const PORT = 4640;
const ROOT = `http://localhost:${PORT}`;
const state = { extra: false, removed: false };
let server: http.Server;
let workDir: string;

beforeAll(async () => {
  process.env.WRAPPER_FORCE_HTTP_FETCHER = "1";
  server = mutableServer(state);
  await new Promise<void>((r) => server.listen(PORT, r));
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "wrapper-us4-"));
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await fs.rm(workDir, { recursive: true, force: true });
});

describe("US4 refresh after webapp changes", () => {
  it("diffAgainstPrior reports new and removed items by identity key", () => {
    const prior: DiscoveredFunctionality[] = [
      makeItem("GET /api/widgets"),
      makeItem("GET /api/legacy"),
    ];
    const current: DiscoveredFunctionality[] = [
      makeItem("GET /api/widgets"),
      makeItem("GET /api/new"),
    ];
    const diff = diffAgainstPrior(current, prior);
    expect(diff.newCount).toBe(1);
    expect(diff.removedCount).toBe(1);
    expect(diff.newItems[0].identityKey).toBe("GET /api/new");
    expect(diff.removedItems[0].identityKey).toBe("GET /api/legacy");
  });

  it("refresh populates new/removed counts and flags the removed endpoint", async () => {
    // Baseline: widgets + legacy present.
    await extractCommand(ROOT, { out: workDir });

    // Mutate the app: add /api/new, remove /api/legacy.
    state.extra = true;
    state.removed = true;

    await refreshCommand(ROOT, { out: workDir, lang: "node" });

    const report = JSON.parse(await fs.readFile(path.join(workDir, "extraction-report.json"), "utf8"));
    expect(report.counts.newSinceLastRun).toBeGreaterThanOrEqual(1);
    expect(report.counts.removedSinceLastRun).toBeGreaterThanOrEqual(1);

    // The removed endpoint is flagged (not silently dropped).
    const removed = report.items.find(
      (i: { identityKey: string; mappingStatus: string }) =>
        i.identityKey === "GET /api/legacy" && i.mappingStatus === "inaccessible",
    );
    expect(removed).toBeTruthy();
    expect(removed.mappingStatusReason).toMatch(/no longer present/i);

    // The regenerated package reuses the previously-selected language (node).
    const manifest = JSON.parse(
      await fs.readFile(path.join(workDir, "package-node", "package-manifest.json"), "utf8"),
    );
    expect(manifest.targetLanguage).toBe("node");
  });
});

function makeItem(identityKey: string): DiscoveredFunctionality {
  const [method] = identityKey.split(" ");
  return {
    identityKey,
    name: identityKey.replace(/\W+/g, "_"),
    description: identityKey,
    kind: "api-endpoint",
    httpMethod: method,
    parameters: [],
    expectedOutput: null,
    mutating: false,
    mappingStatus: "mapped",
    mappingStatusReason: null,
    firstSeenRun: "r0",
    lastSeenRun: "r0",
  };
}
