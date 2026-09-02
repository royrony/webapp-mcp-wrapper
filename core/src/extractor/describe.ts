// T028: per-item metadata extraction (name, description, parameters, expected output) (FR-003).
// T046 (US3) extends this to populate mappingStatus/mappingStatusReason for skipped/ambiguous items.

import type { DiscoveredFunctionality, FunctionalityParameter } from "../models/discovered-functionality.js";
import type { RawApiCall } from "./api-sniffer.js";
import { classifyApiEndpoint } from "./classify.js";
import { apiIdentityKey, templatizePath } from "./identity-key.js";

function humanName(method: string, url: string): string {
  const pathname = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  const segs = templatizePath(pathname)
    .split("/")
    .filter((s) => s && s !== "{id}");
  const verb =
    method === "GET" ? "get" : method === "POST" ? "create" : method === "DELETE" ? "delete" : method.toLowerCase();
  const noun = segs.length ? segs.join("_") : "resource";
  return `${verb}_${noun}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128);
}

/** Is the response opaque/unstable enough that we cannot describe its output? */
function isAmbiguous(call: RawApiCall): boolean {
  const sample = call.responseSample;
  if (!sample) return call.method === "GET"; // GET with no observable output shape is ambiguous
  const keys = Object.keys(sample);
  if (keys.length === 0) return true;
  // Heuristic: a single opaque blob-ish field with a volatile sibling (e.g. random + timestamp).
  const hasBlob = keys.some((k) => /blob|data|payload|raw/i.test(k));
  const hasVolatile = keys.some((k) => /ts|time|nonce|random|seed/i.test(k));
  return hasBlob && hasVolatile;
}

function deriveOutput(call: RawApiCall): Record<string, unknown> | null {
  if (!call.responseSample) return null;
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(call.responseSample)) {
    props[k] = { type: Array.isArray(v) ? "array" : typeof v === "object" && v !== null ? "object" : typeof v };
  }
  return { type: "object", properties: props };
}

export interface DescribeContext {
  runId: string;
}

/** Turn a raw API call into a described DiscoveredFunctionality item. */
export function describeApiCall(call: RawApiCall, ctx: DescribeContext): DiscoveredFunctionality {
  const identityKey = apiIdentityKey(call.method, call.url);
  const name = humanName(call.method, call.url);
  const cls = classifyApiEndpoint(call.method, `${name} ${call.url}`);
  const parameters: FunctionalityParameter[] = call.params.map((p) => ({
    name: p.name,
    type: p.type,
    required: p.required,
    source: p.source === "form" ? "form" : p.source,
  }));

  const ambiguous = isAmbiguous(call);
  const expectedOutput = deriveOutput(call);

  let mappingStatus: DiscoveredFunctionality["mappingStatus"] = "mapped";
  let mappingStatusReason: string | null = null;
  if (ambiguous) {
    mappingStatus = "skipped";
    mappingStatusReason =
      "Ambiguous: response shape is opaque/unstable and parameters could not be determined; needs a resolution override.";
  }

  const path = (() => {
    try {
      return new URL(call.url).pathname;
    } catch {
      return call.url;
    }
  })();

  return {
    identityKey,
    name,
    description: `${cls.mutating ? "Performs" : "Reads"} ${call.method} ${path}`,
    kind: "api-endpoint",
    httpMethod: call.method,
    parameters,
    expectedOutput,
    mutating: cls.mutating,
    mappingStatus,
    mappingStatusReason,
    firstSeenRun: ctx.runId,
    lastSeenRun: ctx.runId,
  };
}

/** Describe all raw calls. */
export function describeAll(calls: RawApiCall[], ctx: DescribeContext): DiscoveredFunctionality[] {
  return calls.map((c) => describeApiCall(c, ctx));
}
