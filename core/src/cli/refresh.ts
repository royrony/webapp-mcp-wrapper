// T052: `refresh` — chains extract (diffed against the prior run) then generate, reusing the
// prior --lang / --include-mutating preferences unless overridden (FR-010, SC-005).

import { promises as fs } from "node:fs";
import path from "node:path";

import type { PackageManifest, TargetLanguage } from "../models/package-manifest.js";
import { extractCommand } from "./extract.js";
import { generateCommand } from "./generate.js";
import { defaultOutDir } from "./paths.js";

export interface RefreshOptions {
  authSession?: string;
  lang?: string;
  includeMutating?: boolean;
  out?: string;
  json?: boolean;
}

/** Find the previously used language + mutating preference from an existing package. */
async function priorPreferences(
  outDir: string,
): Promise<{ lang: TargetLanguage; includeMutating: boolean } | null> {
  for (const lang of ["node", "python", "java"] as TargetLanguage[]) {
    const manifestPath = path.join(outDir, `package-${lang}`, "package-manifest.json");
    try {
      const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as PackageManifest;
      const toolsPath = path.join(outDir, `package-${lang}`, "tools.json");
      const tools = JSON.parse(await fs.readFile(toolsPath, "utf8")) as Array<{
        includedByDefault: boolean;
        annotations: { readOnlyHint: boolean };
      }>;
      const includeMutating = tools.some((t) => !t.annotations.readOnlyHint && t.includedByDefault);
      return { lang: manifest.targetLanguage, includeMutating };
    } catch {
      /* try next language */
    }
  }
  return null;
}

export async function refreshCommand(rootUrl: string, opts: RefreshOptions): Promise<number> {
  const outDir = opts.out ?? defaultOutDir(rootUrl);
  const prior = await priorPreferences(outDir);

  const lang = (opts.lang ?? prior?.lang ?? "node") as TargetLanguage;
  const includeMutating = opts.includeMutating ?? prior?.includeMutating ?? false;

  // 1. Extract with diff enabled so new/removed counts are populated.
  const extractCode = await extractCommand(rootUrl, {
    authSession: opts.authSession,
    out: opts.out,
    json: opts.json,
    diff: true,
  });
  if (extractCode !== 0) return extractCode;

  // 2. Regenerate the package with the resolved preferences.
  return generateCommand(rootUrl, {
    lang,
    includeMutating,
    sourceDir: outDir,
    out: path.join(outDir, `package-${lang}`),
    json: opts.json,
  });
}
