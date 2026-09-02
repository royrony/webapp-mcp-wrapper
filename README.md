# Webapp-to-MCP Wrapper

Turn any webapp into an installable, standards-compliant **MCP server** — in the language of your
choice (Node.js/TypeScript, Python, or Java) — with no manual integration work.

A shared TypeScript **core** crawls a target webapp, discovers and classifies its functionality, and
assembles a language-neutral generation manifest (tools, OAuth config, runtime policy). At
generation time you pick one of three peer, pre-built **runtimes** to produce the deployable server,
so behavior is identical across languages *by construction* rather than by three implementations
drifting apart.

## Architecture

```
core/                     shared extractor + CLI + Skill orchestration (Node.js 22 / TS 5)
  src/extractor/          crawler, api-sniffer, spec-discovery, classify, identity-key, dedupe, auth-gate
  src/generator/          build-manifest + ajv contract validation (contracts/ are the source of truth)
  src/report/             run-store, render-report, diff-runs
  src/cli/                extract, apply-overrides, generate, validate, serve, refresh
  src/skill/              SKILL.md (agent-driven flow) + remediation
  src/runtime-spec/       the reliability spec every runtime must match
runtimes/node|python|java one pre-built, JSON-driven MCP server runtime per language
tests/cross-language/     conformance suite asserting the 3 runtimes behave identically
```

## Install & build

```bash
# Core (required)
cd core && npm install && npm run build

# Whichever runtime(s) you want to deploy in:
cd runtimes/node   && npm install && npm run build
cd runtimes/python && pip install -e .
cd runtimes/java   && mvn -q package
```

> This repo pins current stable/LTS toolchains (Node 22, Python 3.13+, Java 21). Re-verify against
> each ecosystem's then-current stable release at implementation start (Constitution Principle VII).
> In a browser-less environment, set `WRAPPER_FORCE_HTTP_FETCHER=1` to crawl server-rendered targets
> without Playwright's browser binary.

## CLI usage

```bash
# 1. Discover functionality and produce an Extraction Report
wrapper extract https://app.example --out ./out [--json] [--auth-session session.json] [--max-pages 50]

# 2. (optional) Resolve ambiguous/skipped items with verified overrides
wrapper apply-overrides https://app.example ./out/overrides.json --out ./out

# 3. Generate an installable package in your chosen language
wrapper generate https://app.example --lang node --source ./out --out ./out/package [--include-mutating]

# 4. Validate the package end-to-end (invokes in-scope tools, exercises OAuth + retry)
wrapper validate ./out/package

# 5. Serve it
wrapper serve ./out/package --mode stdio
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

## OAuth setup

Runtime authentication to the wrapped webapp uses **OAuth 2.1 + PKCE**:

- **stdio / local**: a loopback `127.0.0.1` redirect; a system browser completes authorization.
- **streamable-http / hosted**: a configured public redirect URI (`--redirect-uri`).

Fill in `oauthConfig.json` in the generated package with your webapp's OAuth client registration
(`authorizationEndpoint`, `tokenEndpoint`, `clientId`, `scopes`). Tokens are stored via the OS
keychain locally (or an AES-GCM encrypted file in hosted mode) and **never** appear in logs, the
Extraction Report, or a Validation Run. For webapps without OAuth, a documented API-key fallback is
available (`oauthConfig.fallback.mode = "api-key"`, supplied at runtime via `WRAPPER_API_KEY`).

## Testing

```bash
cd core && npm test                 # unit + contract + integration
cd tests/cross-language && npm install && npm test   # cross-language parity (Principle VI)
```
