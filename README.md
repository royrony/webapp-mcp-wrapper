# Webapp-to-MCP Wrapper

Turn any webapp into an installable, standards-compliant **MCP server** with no manual integration
work.

A shared TypeScript **core** crawls a target webapp, discovers and classifies its functionality, and
assembles a language-neutral generation manifest (tools with per-endpoint host, auth config, runtime
policy). The **Node.js/TypeScript runtime** turns that manifest into the deployable MCP server.

> **Supported runtime:** Node.js/TypeScript is the single supported generated-server runtime
> (constitution v1.3.0, Principle VI). `runtimes/python` and `runtimes/java` exist in-tree but are
> **optional and experimental** — no behavioral-parity guarantee, not covered by the project's
> safety/reliability claims. See their `EXPERIMENTAL.md`.

## Architecture

```
core/                     shared extractor + CLI + Skill orchestration (Node.js 22 / TS 5)
  src/extractor/          crawler, api-sniffer (CDP), spec-discovery, classify, identity-key, dedupe, auth-gate
  src/generator/          build-manifest + ajv contract validation (contracts/ are the source of truth)
  src/report/             run-store, render-report, diff-runs
  src/cli/                extract, apply-overrides, generate, validate, serve, refresh
  src/skill/              SKILL.md (agent-driven flow) + remediation
  src/runtime-spec/       the reliability spec the runtime matches
runtimes/node             the supported JSON-driven MCP server runtime (auth strategies + per-tool host dispatch)
runtimes/python|java      optional, experimental runtimes (see EXPERIMENTAL.md; not supported)
```

## Install & build

```bash
# Core (required)
cd core && npm install && npm run build

# Supported runtime:
cd runtimes/node && npm install && npm run build

# (optional, experimental — not supported; see runtimes/*/EXPERIMENTAL.md)
# cd runtimes/python && pip install -e .
# cd runtimes/java   && mvn -q package
```

> This repo pins current stable/LTS toolchains (Node 22). Re-verify against Node's then-current
> stable release at implementation start (Constitution Principle VII).
> In a browser-less environment, set `WRAPPER_FORCE_HTTP_FETCHER=1` to crawl server-rendered targets
> without Playwright's browser binary (note: `--cdp-url` session-reuse needs a real browser).

## CLI usage

```bash
# 1. Discover functionality and produce an Extraction Report
wrapper extract https://app.example --out ./out [--json] [--cdp-url http://localhost:9222] [--auth-session session.json] [--max-pages 50]

# 2. (optional) Resolve ambiguous/skipped items with verified overrides
wrapper apply-overrides https://app.example ./out/overrides.json --out ./out

# 3. Generate an installable package (Node — the supported runtime)
#    Pick the auth strategy that matches the target:
wrapper generate https://app.example --lang node --source ./out --out ./out/package \
  [--auth-strategy session-reuse --cdp-url http://localhost:9222] [--include-mutating]

# 4. Validate the package end-to-end (invokes in-scope tools, exercises auth + retry)
wrapper validate ./out/package

# 5. Serve it
wrapper serve ./out/package --mode stdio [--cdp-url http://localhost:9222]   # session-reuse reads the live browser
wrapper serve ./out/package --mode streamable-http --port 8080 --redirect-uri https://you.example/callback

# Re-run after the webapp changes (flags additions/removals)
wrapper refresh https://app.example --out ./out
```

Exit codes: `0` success · `1` unreachable URL · `2` invalid args · `3` no extraction run · `4`
overrides schema invalid · `5` unsupported `--lang` · `6` validation failed.

### Safety by default

Mutating (state-changing) tools are **discovered and reported but excluded** from the callable tool
set unless you pass `--include-mutating` (Constitution Principle II). Every tool carries the MCP
`readOnlyHint` / `destructiveHint` / `idempotentHint` annotations.

## Agent-driven (Skill) mode

Load `core/src/skill/SKILL.md` into an AI coding agent and give it only the webapp URL. The agent
collects inputs conversationally, runs `extract`, investigates and resolves ambiguous items via
`apply-overrides`, runs `generate` + `validate`, and does **one** automatic remediation-and-retest
cycle before reporting back — with zero CLI commands typed by the human.

The wrapper itself holds **no LLM credentials** (FR-024): the intelligence lives entirely in the
driving agent. The CLI refuses to start if an LLM/AI-provider API key is present in its environment.

## Using it with AI agents

For step-by-step setup with **Claude, Cursor, Kiro, and generic MCP clients** — both connecting an
agent to a generated server and letting an agent build the server via the Skill — see
[docs/AI-AGENT-INTEGRATION.md](docs/AI-AGENT-INTEGRATION.md).

## Authentication (pluggable) & multi-host

The generated server authenticates to the wrapped webapp at runtime using a **pluggable strategy**
chosen at `generate` time via `--auth-strategy` (recorded in the package's `oauthConfig.json` under
`strategy`). No secrets, tokens, or cookies ever appear in logs, the Extraction Report, or config.

- **`session-reuse`** — reuse a live, logged-in Chrome over the Chrome DevTools Protocol: the server
  reads the target hosts' cookies and attaches them per request, re-reading (and optionally reopening
  the login page) on a 401. Best for cookie/gateway apps that have no OAuth flow. Configure with
  `--cdp-url http://localhost:9222` (overridable at deploy time via `WRAPPER_CDP_URL`). Nothing is
  persisted in plaintext.
- **`oauth`** (default) — OAuth 2.1 + PKCE: loopback `127.0.0.1` redirect for stdio, a configured
  public `--redirect-uri` for hosted. Fill `oauthConfig.json` with your client registration
  (`authorizationEndpoint`, `tokenEndpoint`, `clientId`, `scopes`). Tokens are stored via the OS
  keychain locally (AES-GCM encrypted file in hosted mode).
- **`api-key`** — a user-supplied key/bearer injected into a configured header at runtime, supplied
  via `WRAPPER_API_KEY` (never stored in the package).

**Multi-host (FR-025):** each tool records the origin it was observed against and calls that host at
runtime — so a target whose API lives on a separate host (e.g. `api.example.com`) works without any
single-base-URL configuration.

## Testing

```bash
cd core && npm test              # unit + contract + integration
cd runtimes/node && npm test     # supported runtime: dispatch, auth strategies, per-tool host
```
