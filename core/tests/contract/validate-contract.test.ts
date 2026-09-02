import { describe, it, expect } from "vitest";
import { validateContract, checkContract, ContractValidationError } from "../../src/generator/validate-contract.js";
import type { MCPToolDefinition } from "../../src/models/mcp-tool-definition.js";

const readOnlyTool: MCPToolDefinition = {
  name: "get_widgets",
  description: "List widgets",
  inputSchema: { type: "object", properties: {} },
  outputSchema: null,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  includedByDefault: true,
  sourceIdentityKey: "GET /api/widgets",
};

describe("validate-contract (T017)", () => {
  it("accepts a valid MCPToolDefinition", () => {
    expect(() => validateContract("mcp-tool-definition", readOnlyTool)).not.toThrow();
  });

  it("rejects a mutating tool included by default (FR-012 enforced by schema)", () => {
    const badMutating = {
      ...readOnlyTool,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      includedByDefault: true,
    };
    const res = checkContract("mcp-tool-definition", badMutating);
    expect(res.valid).toBe(false);
  });

  it("accepts an array of tools via the array contract", () => {
    expect(() => validateContract("mcp-tool-definition-array", [readOnlyTool])).not.toThrow();
  });

  it("throws ContractValidationError with messages on invalid data", () => {
    try {
      validateContract("mcp-tool-definition", { name: "x" });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ContractValidationError);
      expect((e as ContractValidationError).errors.length).toBeGreaterThan(0);
    }
  });

  it("validates a package manifest with both deployment modes", () => {
    const manifest = {
      webappTargetId: "example.com",
      sourceRunId: "run-1",
      targetLanguage: "node",
      runtimeVersion: "0.1.0",
      deploymentModes: ["stdio", "streamable-http"],
      runtimePolicy: {
        retry: { maxAttempts: 3, backoff: "exponential-jitter" },
        logging: { structured: true },
      },
    };
    expect(() => validateContract("package-manifest", manifest)).not.toThrow();
  });
});
