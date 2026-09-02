// T017: ajv-backed contract-validation utility.
// Every generated artifact is validated against its contracts/*.schema.json before
// it is written to disk. This is the automated check that closes the earlier gap
// where contract conformance was only asserted, not enforced.

import { Ajv, type ValidateFunction } from "ajv";
import addFormatsImport from "ajv-formats";

// ajv-formats ships as CJS with `module.exports = plugin` plus a `.default`.
// Normalize across the interop shapes so it is callable under NodeNext ESM.
const addFormats = (
  (addFormatsImport as unknown as { default?: unknown }).default ?? addFormatsImport
) as (ajv: Ajv, opts?: unknown) => Ajv;

import extractionReportSchema from "./schemas/extraction-report.schema.json" with { type: "json" };
import mcpToolDefinitionSchema from "./schemas/mcp-tool-definition.schema.json" with { type: "json" };
import oauthConfigSchema from "./schemas/oauth-config.schema.json" with { type: "json" };
import packageManifestSchema from "./schemas/package-manifest.schema.json" with { type: "json" };
import resolutionOverrideSchema from "./schemas/resolution-override.schema.json" with { type: "json" };
import validationRunSchema from "./schemas/validation-run.schema.json" with { type: "json" };

export type ContractName =
  | "extraction-report"
  | "mcp-tool-definition"
  | "mcp-tool-definition-array"
  | "oauth-config"
  | "package-manifest"
  | "resolution-override"
  | "validation-run";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// An array-of-tools schema for validating the whole tools.json document at once.
const toolArraySchema = {
  $id: "https://spec.local/001-webapp-mcp-wrapper/mcp-tool-definition-array.schema.json",
  type: "array",
  items: mcpToolDefinitionSchema,
};

const validators: Record<ContractName, ValidateFunction> = {
  "extraction-report": ajv.compile(extractionReportSchema),
  "mcp-tool-definition": ajv.compile(mcpToolDefinitionSchema),
  "mcp-tool-definition-array": ajv.compile(toolArraySchema),
  "oauth-config": ajv.compile(oauthConfigSchema),
  "package-manifest": ajv.compile(packageManifestSchema),
  "resolution-override": ajv.compile(resolutionOverrideSchema),
  "validation-run": ajv.compile(validationRunSchema),
};

export class ContractValidationError extends Error {
  constructor(
    public readonly contract: ContractName,
    public readonly errors: string[],
  ) {
    super(`Contract "${contract}" validation failed:\n  - ${errors.join("\n  - ")}`);
    this.name = "ContractValidationError";
  }
}

/** Validate `data` against a named contract. Returns the data (typed) or throws. */
export function validateContract<T>(contract: ContractName, data: unknown): T {
  const validate = validators[contract];
  const ok = validate(data);
  if (!ok) {
    const errors = (validate.errors ?? []).map(
      (e) => `${e.instancePath || "(root)"} ${e.message ?? "invalid"}`,
    );
    throw new ContractValidationError(contract, errors);
  }
  return data as T;
}

/** Non-throwing variant used where callers want to branch on validity. */
export function checkContract(
  contract: ContractName,
  data: unknown,
): { valid: boolean; errors: string[] } {
  const validate = validators[contract];
  const ok = validate(data);
  if (ok) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: (validate.errors ?? []).map(
      (e) => `${e.instancePath || "(root)"} ${e.message ?? "invalid"}`,
    ),
  };
}
