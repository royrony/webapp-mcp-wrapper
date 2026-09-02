// T024: webapp URL reachability validation (FR-009; exit code 1 per cli-commands.md).

import type { FetchedResponse, Fetcher } from "./fetcher.js";

export interface TargetValidationResult {
  reachable: boolean;
  status?: number;
  error?: string;
  response?: FetchedResponse;
}

/** Validate the root URL is well-formed and reachable before crawling begins. */
export async function validateTarget(
  rootUrl: string,
  fetcher: Fetcher,
): Promise<TargetValidationResult> {
  let parsed: URL;
  try {
    parsed = new URL(rootUrl);
  } catch {
    return { reachable: false, error: `Malformed URL: ${rootUrl}` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { reachable: false, error: `Unsupported protocol: ${parsed.protocol}` };
  }
  try {
    const res = await fetcher.fetch(rootUrl);
    // Any HTTP response (even 4xx/5xx) means the host is reachable; a network error does not.
    if (res.status === 0) {
      return { reachable: false, error: "No HTTP response" };
    }
    return { reachable: true, status: res.status, response: res };
  } catch (e) {
    return { reachable: false, error: (e as Error).message };
  }
}
