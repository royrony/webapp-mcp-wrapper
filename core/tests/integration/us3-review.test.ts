// US3 integration: trustworthy review — mapped vs skipped vs inaccessible, mutating labels,
// auth-gate recording (FR-011), and --auth-session / --include-mutating behavior.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createServer } from "../fixtures/sample-app/server.mjs";
import { HttpFetcher } from "../../src/extractor/fetcher.js";
import { runExtraction } from "../../src/extractor/pipeline.js";
import { domainBoundaryOf } from "../../src/extractor/robots-policy.js";
import { renderReportText } from "../../src/report/render-report.js";
import { buildToolManifest } from "../../src/generator/build-manifest.js";
import { toInaccessibleAreas, isAuthGate } from "../../src/extractor/auth-gate.js";

let server: ReturnType<typeof createServer>;
const PORT = 4630;
const ROOT = `http://localhost:${PORT}`;

beforeAll(async () => {
  server = createServer();
  await new Promise<void>((r) => server.listen(PORT, r));
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("US3 review before trusting output", () => {
  it("records an auth-gated area (not robots-disallowed) as inaccessible with a reason (FR-011)", async () => {
    const out = await runExtraction({
      rootUrl: ROOT,
      domainBoundary: domainBoundaryOf(ROOT),
      webappTargetId: "localhost",
      maxPages: 50,
      fetcher: new HttpFetcher(),
    });
    // /account returns 401 and is NOT robots-disallowed, so it must be reported inaccessible.
    const account = out.report.inaccessibleAreas.find((a) => a.path.startsWith("/account"));
    expect(account).toBeTruthy();
    expect(account!.reason).toMatch(/authentication required/i);
  });

  it("separates mapped from skipped and labels mutating items distinctly", async () => {
    const out = await runExtraction({
      rootUrl: ROOT,
      domainBoundary: domainBoundaryOf(ROOT),
      webappTargetId: "localhost",
      maxPages: 50,
      fetcher: new HttpFetcher(),
    });
    const text = renderReportText(out.report);
    expect(text).toContain("Mapped:");
    expect(text).toContain("Skipped:");
    expect(text).toContain("[MUTATING]");
    expect(text).toContain("[read-only]");

    const mutating = out.report.items.filter((i) => i.mutating);
    expect(mutating.length).toBeGreaterThanOrEqual(1);
    const skipped = out.report.items.filter((i) => i.mappingStatus === "skipped");
    for (const s of skipped) expect(s.mappingStatusReason).toBeTruthy();
  });

  it("reaches the auth-gated area when an auth session is supplied (--auth-session)", async () => {
    const authed = await runExtraction({
      rootUrl: ROOT,
      domainBoundary: domainBoundaryOf(ROOT),
      webappTargetId: "localhost",
      maxPages: 50,
      fetcher: new HttpFetcher({ cookie: "session=abc" }),
      authSession: true,
    });
    // With a session, /account is reachable so it is NOT recorded as inaccessible.
    const stillGated = authed.report.inaccessibleAreas.find((a) => a.path.startsWith("/account"));
    expect(stillGated).toBeUndefined();
    expect(authed.target.authMode).toBe("oauth");
  });

  it("--include-mutating adds the mutating tool to the served scope (schema keeps includedByDefault false)", async () => {
    const out = await runExtraction({
      rootUrl: ROOT,
      domainBoundary: domainBoundaryOf(ROOT),
      webappTargetId: "localhost",
      maxPages: 50,
      fetcher: new HttpFetcher(),
    });
    const { buildToolManifest, buildToolScope } = await import("../../src/generator/build-manifest.js");
    const tools = buildToolManifest(out.functionality, { includeMutating: false });
    const mName = "create_api_widgets";
    // Schema invariant: mutating tool is NEVER includedByDefault (FR-012 / Principle II).
    expect(tools.find((t) => t.name === mName)!.includedByDefault).toBe(false);

    const scopeOff = buildToolScope(tools, { includeMutating: false });
    const scopeOn = buildToolScope(tools, { includeMutating: true });
    expect(scopeOff).not.toContain(mName);
    expect(scopeOn).toContain(mName); // opt-in puts it in the served scope
  });

  it("auth-gate helpers behave correctly", () => {
    expect(isAuthGate(401)).toBe(true);
    expect(isAuthGate(403)).toBe(true);
    expect(isAuthGate(200)).toBe(false);
    const areas = toInaccessibleAreas([
      { url: "http://x/account", status: 401 },
      { url: "http://x/account", status: 401 },
    ]);
    expect(areas).toHaveLength(1);
  });
});
