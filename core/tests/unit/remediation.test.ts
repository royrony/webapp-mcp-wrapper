import { describe, it, expect } from "vitest";
import { remediateOnce } from "../../src/skill/remediation.js";
import type { ValidationRun } from "../../src/models/validation-run.js";

const failing: ValidationRun = {
  packageId: "run-1:node",
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  toolResults: [{ toolName: "x", invoked: true, success: false, error: "boom" }],
  authFlowExercised: true,
  retryBehaviorVerified: true,
  remediationAttempts: [],
  overallStatus: "failed",
};

describe("remediateOnce (T043)", () => {
  it("runs exactly one generate+validate cycle and resolves when the retest passes", async () => {
    let generateCalls = 0;
    let validateCalls = 0;
    const readyRun: ValidationRun = { ...failing, overallStatus: "ready", toolResults: [{ toolName: "x", invoked: true, success: true }] };
    const res = await remediateOnce(
      failing,
      {
        issue: "tool x failed",
        action: "adjusted override for x",
        regenerate: { rootUrl: "http://x", options: { lang: "node" } },
        revalidate: { packageDir: "/tmp/pkg" },
      },
      {
        generate: (async () => (generateCalls++, 0)) as never,
        validate: (async () => (validateCalls++, 0)) as never,
        readValidation: async () => readyRun,
      },
    );
    expect(generateCalls).toBe(1);
    expect(validateCalls).toBe(1);
    expect(res.outcome).toBe("resolved");
    expect(res.finalRun?.remediationAttempts).toHaveLength(1);
  });

  it("reports unresolved after one cycle if the retest still fails", async () => {
    const res = await remediateOnce(
      failing,
      {
        issue: "tool x failed",
        action: "tried a fix",
        regenerate: { rootUrl: "http://x", options: { lang: "node" } },
        revalidate: { packageDir: "/tmp/pkg" },
      },
      {
        generate: (async () => 0) as never,
        validate: (async () => 6) as never,
        readValidation: async () => failing,
      },
    );
    expect(res.outcome).toBe("unresolved");
  });

  it("does nothing when the run is already ready", async () => {
    const ready: ValidationRun = { ...failing, overallStatus: "ready" };
    const res = await remediateOnce(ready, {} as never, { readValidation: async () => ready });
    expect(res.outcome).toBe("not-needed");
    expect(res.attempted).toBe(false);
  });
});
