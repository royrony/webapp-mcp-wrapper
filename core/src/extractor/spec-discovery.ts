// T027: static discovery of published OpenAPI/GraphQL SDL documents (research.md #1).

import type { Fetcher } from "./fetcher.js";
import type { RawApiCall } from "./api-sniffer.js";

const OPENAPI_PATHS = [
  "/openapi.json",
  "/swagger.json",
  "/v3/api-docs",
  "/api-docs",
  "/openapi.yaml",
];

export interface SpecDiscoveryResult {
  found: boolean;
  source?: string;
  calls: RawApiCall[];
}

/** Convert an OpenAPI paths object into RawApiCall entries. */
function openApiToCalls(baseUrl: string, doc: Record<string, unknown>): RawApiCall[] {
  const calls: RawApiCall[] = [];
  const paths = (doc.paths ?? {}) as Record<string, Record<string, unknown>>;
  for (const [pathTemplate, methods] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!["get", "post", "put", "patch", "delete"].includes(method.toLowerCase())) continue;
      const operation = op as { parameters?: Array<Record<string, unknown>> };
      const params = (operation.parameters ?? []).map((p) => ({
        name: String(p.name ?? ""),
        type: "string",
        required: Boolean(p.required),
        source: (p.in === "query" ? "query" : p.in === "path" ? "query" : "body") as
          | "query"
          | "body"
          | "form",
      }));
      let url: string;
      try {
        url = new URL(pathTemplate, baseUrl).toString();
      } catch {
        url = pathTemplate;
      }
      calls.push({
        url,
        method: method.toUpperCase(),
        params,
        responseSample: null,
        contentType: "application/json",
      });
    }
  }
  return calls;
}

/** Probe well-known OpenAPI locations under the root; return any endpoints found. */
export async function discoverSpecs(rootUrl: string, fetcher: Fetcher): Promise<SpecDiscoveryResult> {
  for (const p of OPENAPI_PATHS) {
    let url: string;
    try {
      url = new URL(p, rootUrl).toString();
    } catch {
      continue;
    }
    try {
      const res = await fetcher.fetch(url);
      if (res.status !== 200) continue;
      if (!res.contentType.includes("json") && !res.body.trimStart().startsWith("{")) continue;
      const doc = JSON.parse(res.body) as Record<string, unknown>;
      if (doc.openapi || doc.swagger || doc.paths) {
        return { found: true, source: url, calls: openApiToCalls(rootUrl, doc) };
      }
    } catch {
      /* not present / not parseable — keep probing */
    }
  }
  return { found: false, calls: [] };
}
