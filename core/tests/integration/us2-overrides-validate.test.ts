// US2 integration: apply-overrides verification, validate, no-LLM guard, remediation.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createServer } from "../fixtures/sample-app/server.mjs";
import { HttpFetcher } from "../../src/extractor/fetcher.js";
import { extractCommand } from "../../src/cli/extract.js";
import { applyOverridesCommand } from "../../src/cli/apply-overrides.js";
import { generateCommand } from "../../src/cli/generate.js";
import { validateCommand } from "../../src/cli/validate.js";
import { assertNoLlmCredentials, LlmCredentialError } from "../../src/cli/no-llm-credentials-guard.js";
import type { MCPToolDefinition } from "../../src/models/mcp-tool-definition.js";

let server: ReturnType<typeof createServer>;
const PORT = 4620;
const ROOT = `http://localhost:${PORT}`;
let workDir: string;

beforeAll(async () => {
  process.env.WRAPPER_FORCE_HTTP_FETCHER = "1";
  server = createServer();
  await new Promise<void>((r) => server.listen(PORT, r));
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), "wrapper-us2-"));
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await fs.rm(workDir, { recursive: true, force: true });
});

describe("US2 hands-off flow", () => {
  it("no-LLM-credentials guard throws when an LLM key is present", () => {
    expect(() => assertNoLlmCredentials({ OPENAI_API_KEY: "sk-xxx" } as NodeJS.ProcessEnv)).toThrow(
      LlmCredentialError,
    );
    expect(() => assertNoLlmCredentials({} as NodeJS.ProcessEnv)).not.toThrow();
  });

  it("apply-overrides verifies with a real call and promotes only on success", async () => {
    await extractCommand(ROOT, { out: workDir });

    const overridesFile = path.join(workDir, "overrides.json");
    await fs.writeFile(
      overridesFile,
      JSON.stringify([
        {
          identityKey: "GET /api/report",
          suppliedBy: "agent",
          proposedFix: { description: "Daily activity report" },
        },
      ]),
      "utf8",
    );

    await applyOverridesCommand(ROOT, overridesFile, { out: workDir, fetcher: new HttpFetcher() });

    // The override targeted a reachable endpoint, so it should be verified + applied.
    const store = JSON.parse(await fs.readFile(path.join(workDir, "runs.json"), "utf8"));
    const applied = store.overrides.find((o: { identityKey: string }) => o.identityKey === "GET /api/report");
    expect(applied.verification.attempted).toBe(true);
    expect(applied.verification.succeeded).toBe(true);
    expect(applied.appliedAt).toBeTruthy();
  });

  it("rejects an overrides file that fails schema validation (exit 4)", async () => {
    const bad = path.join(workDir, "bad-overrides.json");
    await fs.writeFile(bad, JSON.stringify([{ suppliedBy: "agent" }]), "utf8"); // missing identityKey + proposedFix
    await expect(applyOverridesCommand(ROOT, bad, { out: workDir, fetcher: new HttpFetcher() })).rejects.toMatchObject(
      { code: 4 },
    );
  });

  it("generate after overrides includes the previously-skipped item as mapped", async () => {
    const pkgDir = path.join(workDir, "package-node");
    await generateCommand(ROOT, { lang: "node", sourceDir: workDir, out: pkgDir });
    const tools = JSON.parse(await fs.readFile(path.join(pkgDir, "tools.json"), "utf8")) as MCPToolDefinition[];
    // /api/report was skipped, resolved via override -> now a generated read-only tool.
    expect(tools.some((t) => t.sourceIdentityKey === "GET /api/report")).toBe(true);
  });

  it("validate produces a ready ValidationRun with auth + retry verified", async () => {
    const pkgDir = path.join(workDir, "package-node");
    const code = await validateCommand(pkgDir, { simulateTransientFailure: true });
    expect(code).toBe(0);
    const run = JSON.parse(await fs.readFile(path.join(pkgDir, "validation-run.json"), "utf8"));
    expect(run.overallStatus).toBe("ready");
    expect(run.authFlowExercised).toBe(true);
    expect(run.retryBehaviorVerified).toBe(true);
    // FR-022: no out-of-scope (mutating, excluded) tool appears in toolResults.
    const names = run.toolResults.map((r: { toolName: string }) => r.toolName);
    expect(names).not.toContain("create_api_widgets");
  });

  it("validate returns exit 6 and failed status when a tool fails", async () => {
    const pkgDir = path.join(workDir, "package-node");
    const code = await validateCommand(pkgDir, {
      simulateTransientFailure: true,
      invokeTool: async () => ({ success: false, error: "boom" }),
    });
    expect(code).toBe(6);
  });
});
