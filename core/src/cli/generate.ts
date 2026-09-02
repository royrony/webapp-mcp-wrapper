// T032: `generate --lang <node|python|java>` — produces a contract-validated
// GeneratedMCPServerPackage (FR-006, FR-018). T049 (US3) adds --include-mutating.

import { promises as fs } from "node:fs";
import path from "node:path";

import type { OAuthConfig } from "../models/oauth-config.js";
import type { PackageManifest, TargetLanguage } from "../models/package-manifest.js";
import { RUNTIME_VERSIONS, SHARED_RUNTIME_POLICY } from "../models/package-manifest.js";
import { buildToolManifest, buildToolScope } from "../generator/build-manifest.js";
import { validateContract } from "../generator/validate-contract.js";
import { RunStore } from "../report/run-store.js";
import { domainBoundaryOf } from "../extractor/robots-policy.js";
import { EXIT, CliError } from "./exit-codes.js";
import { defaultOutDir, webappTargetId } from "./paths.js";
import type { WebappTarget } from "../models/webapp-target.js";

const SUPPORTED_LANGS: TargetLanguage[] = ["node", "python", "java"];

export interface GenerateOptions {
  lang?: string;
  run?: string;
  includeMutating?: boolean;
  out?: string;
  json?: boolean;
  /** Directory holding the extraction run store; defaults to the target's default out dir. */
  sourceDir?: string;
}

export async function generateCommand(rootUrl: string, opts: GenerateOptions): Promise<number> {
  const lang = opts.lang as TargetLanguage | undefined;
  if (!lang || !SUPPORTED_LANGS.includes(lang)) {
    throw new CliError(EXIT.UNSUPPORTED_LANG, `Unsupported --lang: ${opts.lang ?? "(missing)"}. Use node|python|java.`);
  }

  const targetId = webappTargetId(rootUrl);
  const sourceDir = opts.sourceDir ?? defaultOutDir(rootUrl);
  const placeholderTarget: WebappTarget = {
    id: targetId,
    rootUrl,
    domainBoundary: domainBoundaryOf(rootUrl),
    authMode: "none",
    robotsPolicy: { disallow: [], raw: "" },
    createdAt: new Date().toISOString(),
    lastExtractedAt: new Date().toISOString(),
  };
  const store = await RunStore.open(sourceDir, placeholderTarget);

  const run = opts.run ? store.runById(opts.run) : store.latestRun();
  if (!run) {
    throw new CliError(EXIT.NO_EXTRACTION_RUN, `No extraction run found for ${rootUrl}. Run \`extract\` first.`);
  }

  // Merge applied overrides so previously-skipped-but-resolved items are generated.
  const functionality = applyStoredOverrides(run.functionality, store);

  const tools = buildToolManifest(functionality, { includeMutating: Boolean(opts.includeMutating) });
  const toolScope = buildToolScope(tools, { includeMutating: Boolean(opts.includeMutating) });

  // Validate tools.json against its contract before writing (T017).
  validateContract("mcp-tool-definition-array", tools);

  const manifest: PackageManifest = {
    webappTargetId: targetId,
    sourceRunId: run.report.runId,
    targetLanguage: lang,
    runtimeVersion: RUNTIME_VERSIONS[lang],
    deploymentModes: ["stdio", "streamable-http"],
    runtimePolicy: SHARED_RUNTIME_POLICY,
  };
  validateContract("package-manifest", manifest);

  const oauthConfig: OAuthConfig = {
    authorizationEndpoint: "https://REPLACE-ME.example/oauth/authorize",
    tokenEndpoint: "https://REPLACE-ME.example/oauth/token",
    clientId: "REPLACE-ME",
    redirectMode: "loopback",
    scopes: [],
  };
  validateContract("oauth-config", oauthConfig);

  const outDir = opts.out ?? path.join(sourceDir, `package-${lang}`);
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "package-manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  await fs.writeFile(path.join(outDir, "tools.json"), JSON.stringify(tools, null, 2), "utf8");
  await fs.writeFile(path.join(outDir, "oauthConfig.json"), JSON.stringify(oauthConfig, null, 2), "utf8");
  // Served/validated tool scope (FR-012 opt-in), recorded outside the schema-governed tools.json.
  await fs.writeFile(
    path.join(outDir, "tool-scope.json"),
    JSON.stringify({ includeMutating: Boolean(opts.includeMutating), tools: toolScope }, null, 2),
    "utf8",
  );

  const summary = {
    package: outDir,
    targetLanguage: lang,
    runtimeVersion: manifest.runtimeVersion,
    toolCount: tools.length,
    inScopeCount: toolScope.length,
    includeMutating: Boolean(opts.includeMutating),
    sourceRunId: run.report.runId,
  };

  if (opts.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  } else {
    process.stdout.write(
      `Generated ${lang} package at ${outDir}\n` +
        `  ${tools.length} tools (${toolScope.length} in scope) from run ${run.report.runId}\n`,
    );
  }
  return EXIT.SUCCESS;
}

/** Promote functionality items that have a successfully-applied override to mapped. */
function applyStoredOverrides(
  functionality: import("../models/discovered-functionality.js").DiscoveredFunctionality[],
  store: RunStore,
): import("../models/discovered-functionality.js").DiscoveredFunctionality[] {
  const applied = store.appliedOverrides();
  if (applied.length === 0) return functionality;
  const byKey = new Map(applied.map((o) => [o.identityKey, o]));
  return functionality.map((f) => {
    const o = byKey.get(f.identityKey);
    if (!o) return f;
    return {
      ...f,
      mappingStatus: "mapped" as const,
      mappingStatusReason: null,
      description: o.proposedFix.description ?? f.description,
      parameters: o.proposedFix.parameters ?? f.parameters,
      expectedOutput: o.proposedFix.outputSchema ?? f.expectedOutput,
    };
  });
}
