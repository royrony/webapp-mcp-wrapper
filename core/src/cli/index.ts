#!/usr/bin/env node
// T022: CLI scaffold — extract / apply-overrides / generate / validate / serve / refresh
// subcommands, shared --json flag, and the exit-code conventions in contracts/cli-commands.md.

import { Command } from "commander";

import { assertNoLlmCredentials } from "./no-llm-credentials-guard.js";
import { EXIT, CliError } from "./exit-codes.js";
import { extractCommand } from "./extract.js";
import { generateCommand } from "./generate.js";
import { applyOverridesCommand } from "./apply-overrides.js";
import { validateCommand } from "./validate.js";
import { serveCommand } from "./serve.js";
import { refreshCommand } from "./refresh.js";

async function runHandler(fn: () => Promise<number>): Promise<void> {
  try {
    const code = await fn();
    process.exitCode = code;
  } catch (e) {
    if (e instanceof CliError) {
      process.stderr.write(`error: ${e.message}\n`);
      process.exitCode = e.code;
    } else {
      process.stderr.write(`error: ${(e as Error).message}\n`);
      process.exitCode = EXIT.INVALID_ARGS;
    }
  }
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("wrapper")
    .description("Webapp-to-MCP Wrapper — generate MCP servers from a webapp")
    .version("0.1.0");

  program
    .command("extract")
    .argument("<root-url>", "webapp entry point")
    .option("--auth-session <file>", "captured cookie/header session for gated areas")
    .option("--cdp-url <url>", "attach to a live Chrome DevTools session (reuses the browser login)")
    .option("--max-pages <n>", "crawl scope bound", (v) => parseInt(v, 10))
    .option("--out <dir>", "output directory")
    .option("--json", "emit machine-readable JSON")
    .action((rootUrl, opts) =>
      runHandler(() =>
        extractCommand(rootUrl, {
          authSession: opts.authSession,
          cdpUrl: opts.cdpUrl,
          maxPages: opts.maxPages,
          out: opts.out,
          json: Boolean(opts.json),
        }),
      ),
    );

  program
    .command("apply-overrides")
    .argument("<root-url>", "webapp entry point")
    .argument("<overrides-file>", "resolution-override.schema.json file")
    .option("--run <runId>", "target a specific run")
    .option("--cdp-url <url>", "attach to a live Chrome DevTools session so verification calls are authenticated")
    .option("--out <dir>", "run store directory")
    .option("--json", "emit machine-readable JSON")
    .action((rootUrl, overridesFile, opts) =>
      runHandler(() =>
        applyOverridesCommand(rootUrl, overridesFile, {
          run: opts.run,
          cdpUrl: opts.cdpUrl,
          out: opts.out,
          json: Boolean(opts.json),
        }),
      ),
    );

  program
    .command("generate")
    .argument("<root-url>", "webapp entry point")
    .requiredOption("--lang <lang>", "target language: node|python|java")
    .option("--run <runId>", "generate from a specific run")
    .option("--include-mutating", "opt mutating tools into includedByDefault")
    .option("--source <dir>", "extraction run store directory (defaults to extract's default out dir)")
    .option("--out <dir>", "output directory")
    .option("--json", "emit machine-readable JSON")
    .action((rootUrl, opts) =>
      runHandler(() =>
        generateCommand(rootUrl, {
          lang: opts.lang,
          run: opts.run,
          includeMutating: Boolean(opts.includeMutating),
          out: opts.out,
          sourceDir: opts.source,
          json: Boolean(opts.json),
        }),
      ),
    );

  program
    .command("validate")
    .argument("<package-dir>", "generated package directory")
    .option("--no-simulate-transient-failure", "skip the forced transient-failure check")
    .option("--json", "emit machine-readable JSON")
    .action((packageDir, opts) =>
      runHandler(() =>
        validateCommand(packageDir, {
          simulateTransientFailure: opts.simulateTransientFailure !== false,
          json: Boolean(opts.json),
        }),
      ),
    );

  program
    .command("serve")
    .argument("<package-dir>", "generated package directory")
    .requiredOption("--mode <mode>", "stdio|streamable-http")
    .option("--port <n>", "port for streamable-http", (v) => parseInt(v, 10))
    .option("--redirect-uri <uri>", "public OAuth callback for hosted mode")
    .option("--json", "emit machine-readable JSON")
    .action((packageDir, opts) =>
      runHandler(() =>
        serveCommand(packageDir, {
          mode: opts.mode,
          port: opts.port,
          redirectUri: opts.redirectUri,
          json: Boolean(opts.json),
        }),
      ),
    );

  program
    .command("refresh")
    .argument("<root-url>", "webapp entry point")
    .option("--auth-session <file>", "captured cookie/header session")
    .option("--cdp-url <url>", "attach to a live Chrome DevTools session")
    .option("--lang <lang>", "override the previously selected language")
    .option("--include-mutating", "override mutating inclusion")
    .option("--out <dir>", "output directory")
    .option("--json", "emit machine-readable JSON")
    .action((rootUrl, opts) =>
      runHandler(() =>
        refreshCommand(rootUrl, {
          authSession: opts.authSession,
          cdpUrl: opts.cdpUrl,
          lang: opts.lang,
          includeMutating: opts.includeMutating,
          out: opts.out,
          json: Boolean(opts.json),
        }),
      ),
    );

  return program;
}

async function main(): Promise<void> {
  // FR-024: fail fast if any LLM/AI-provider credential is referenced by wrapper code.
  try {
    assertNoLlmCredentials();
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`);
    process.exitCode = EXIT.INVALID_ARGS;
    return;
  }
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
