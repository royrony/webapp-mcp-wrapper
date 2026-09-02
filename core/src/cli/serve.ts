// T036: `serve` CLI command — a thin dispatcher that runs a generated package in whichever
// runtime matches its recorded targetLanguage. The actual serving logic lives in the runtime
// package, not the core.

import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import type { PackageManifest, DeploymentMode } from "../models/package-manifest.js";
import { EXIT, CliError } from "./exit-codes.js";

export interface ServeOptions {
  mode?: string;
  port?: number;
  redirectUri?: string;
  json?: boolean;
  /** Test hook: don't actually spawn; just resolve the dispatch plan. */
  dryRun?: boolean;
}

export interface DispatchPlan {
  command: string;
  args: string[];
  targetLanguage: string;
  mode: DeploymentMode;
}

const RUNTIME_DIR = (lang: string): string =>
  path.resolve(new URL("../../..", import.meta.url).pathname, "runtimes", lang);

/** Resolve how to launch the runtime for a package + mode. */
export async function resolveDispatch(
  packageDir: string,
  mode: DeploymentMode,
  extra: { port?: number; redirectUri?: string } = {},
): Promise<DispatchPlan> {
  const manifestRaw = await fs.readFile(path.join(packageDir, "package-manifest.json"), "utf8");
  const manifest = JSON.parse(manifestRaw) as PackageManifest;
  const lang = manifest.targetLanguage;

  const commonArgs = [packageDir, "--mode", mode];
  if (extra.port) commonArgs.push("--port", String(extra.port));
  if (extra.redirectUri) commonArgs.push("--redirect-uri", extra.redirectUri);

  switch (lang) {
    case "node":
      return { command: "node", args: [path.join(RUNTIME_DIR("node"), "dist", "server.js"), ...commonArgs], targetLanguage: lang, mode };
    case "python":
      return { command: "python3", args: ["-m", "wrapper_runtime.server", ...commonArgs], targetLanguage: lang, mode };
    case "java":
      return {
        command: "java",
        args: ["-cp", path.join(RUNTIME_DIR("java"), "target", "classes"), "wrapper.Server", ...commonArgs],
        targetLanguage: lang,
        mode,
      };
    default:
      throw new CliError(EXIT.UNSUPPORTED_LANG, `Unknown target language in manifest: ${lang}`);
  }
}

export async function serveCommand(packageDir: string, opts: ServeOptions): Promise<number> {
  const mode = (opts.mode ?? "stdio") as DeploymentMode;
  if (mode !== "stdio" && mode !== "streamable-http") {
    throw new CliError(EXIT.INVALID_ARGS, `--mode must be stdio or streamable-http`);
  }
  const plan = await resolveDispatch(packageDir, mode, { port: opts.port, redirectUri: opts.redirectUri });

  if (opts.dryRun) {
    if (opts.json) process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
    else process.stdout.write(`would run: ${plan.command} ${plan.args.join(" ")}\n`);
    return EXIT.SUCCESS;
  }

  return new Promise<number>((resolve) => {
    const child = spawn(plan.command, plan.args, { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 0));
    child.on("error", (err) => {
      process.stderr.write(`Failed to launch ${plan.targetLanguage} runtime: ${err.message}\n`);
      resolve(1);
    });
  });
}
