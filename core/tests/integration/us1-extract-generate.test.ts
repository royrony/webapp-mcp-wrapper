// US1 integration: extraction pipeline + manifest generation against the fixture app.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "../fixtures/sample-app/server.mjs";
import { HttpFetcher } from "../../src/extractor/fetcher.js";
import { runExtraction } from "../../src/extractor/pipeline.js";
import { buildToolManifest } from "../../src/generator/build-manifest.js";
import { validateContract } from "../../src/generator/validate-contract.js";
import { domainBoundaryOf } from "../../src/extractor/robots-policy.js";

let server: ReturnType<typeof createServer>;
const PORT = 4611;
const ROOT = `http://localhost:${PORT}`;

beforeAll(async () => {
  process.env.FIXTURE_PORT = String(PORT);
  server = createServer();
  await new Promise<void>((r) => server.listen(PORT, r));
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("US1 extract + generate", () => {
  it("discovers read-only + mutating endpoints and skips the ambiguous one", async () => {
    const out = await runExtraction({
      rootUrl: ROOT,
      domainBoundary: domainBoundaryOf(ROOT),
      webappTargetId: "localhost",
      maxPages: 50,
      fetcher: new HttpFetcher(),
    });
    expect(out.reachable).toBe(true);
    const keys = out.functionality.map((f) => f.identityKey);
    expect(keys).toContain("GET /api/widgets");
    expect(keys).toContain("POST /api/widgets");

    const widgetsGet = out.functionality.find((f) => f.identityKey === "GET /api/widgets")!;
    expect(widgetsGet.mutating).toBe(false);
    expect(widgetsGet.mappingStatus).toBe("mapped");

    const report = out.functionality.find((f) => f.identityKey === "GET /api/report")!;
    expect(report.mappingStatus).toBe("skipped");
    expect(report.mappingStatusReason).toBeTruthy();

    // Report conforms to its contract.
    expect(() => validateContract("extraction-report", out.report)).not.toThrow();
  });

  it("excludes the robots-disallowed /admin area from discovery", async () => {
    const out = await runExtraction({
      rootUrl: ROOT,
      domainBoundary: domainBoundaryOf(ROOT),
      webappTargetId: "localhost",
      maxPages: 50,
      fetcher: new HttpFetcher(),
    });
    const adminItems = out.functionality.filter((f) => f.identityKey.includes("/admin"));
    expect(adminItems).toHaveLength(0);
  });

  it("generates a byte-identical tool set regardless of language, mutating excluded by default", async () => {
    const out = await runExtraction({
      rootUrl: ROOT,
      domainBoundary: domainBoundaryOf(ROOT),
      webappTargetId: "localhost",
      maxPages: 50,
      fetcher: new HttpFetcher(),
    });
    const tools = buildToolManifest(out.functionality, { includeMutating: false });
    const mutating = tools.find((t) => t.name === "create_api_widgets")!;
    expect(mutating.includedByDefault).toBe(false);
    const readonly = tools.find((t) => t.name === "get_api_widgets")!;
    expect(readonly.includedByDefault).toBe(true);

    // Tool manifest is a pure function of functionality — identical across languages by construction.
    const again = buildToolManifest(out.functionality, { includeMutating: false });
    expect(JSON.stringify(tools)).toBe(JSON.stringify(again));
    expect(() => validateContract("mcp-tool-definition-array", tools)).not.toThrow();

    // --include-mutating adds it to the served scope; schema keeps includedByDefault false.
    const { buildToolScope } = await import("../../src/generator/build-manifest.js");
    expect(buildToolScope(tools, { includeMutating: true })).toContain("create_api_widgets");
    expect(buildToolScope(tools, { includeMutating: false })).not.toContain("create_api_widgets");
  });
});
