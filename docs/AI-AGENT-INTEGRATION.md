# Integrating the Webapp-to-MCP Wrapper with AI Agents

This guide covers **installing** the wrapper, **generating** an MCP server from a webapp, and
**wiring it into different AI agents** — either as a running MCP server the agent connects to, or
via the packaged **Skill** that lets an agent drive the whole flow itself.

There are two distinct integration paths, and it helps to keep them separate:

| Path | What the agent gets | When to use |
|------|--------------------|-------------|
| **A. Generated MCP server** | The webapp's functionality exposed as MCP tools the agent can call | You want an AI agent to *use* a webapp's features |
| **B. Skill-driven generation** | The wrapper's CLI, driven conversationally by the agent | You want an AI agent to *build* the MCP server for you, hands-off |

---

## Prerequisites

- **Node.js 22+** (required — runs the shared core and CLI).
- The runtime for your chosen output language, if different from Node:
  - Node output → Node.js 22+
  - Python output → Python 3.11+ (`pip install -e runtimes/python`)
  - Java output → JRE 21+ (`mvn -q package` in `runtimes/java`)
- In a browser-less environment, set `WRAPPER_FORCE_HTTP_FETCHER=1` to crawl server-rendered
  targets without Playwright's browser binary.

## Install

```bash
git clone <this-repo-url> webapp-mcp-wrapper
cd webapp-mcp-wrapper

# Core (required)
cd core && npm install && npm run build && cd ..

# Whichever runtime you'll deploy in:
cd runtimes/node   && npm install && npm run build && cd ../..
cd runtimes/python && pip install -e . && cd ../..
cd runtimes/java   && mvn -q package && cd ../..
```

Optionally link the CLI so `wrapper` is on your PATH:

```bash
cd core && npm link      # provides the `wrapper` command
# now: wrapper extract https://app.example --out ./out
```

If you don't link, invoke it directly: `node core/dist/cli/index.js <command> ...`.

---

## Path A — Generate an MCP server and connect an AI agent to it

### 1. Generate the package

```bash
wrapper extract  https://app.example --out ./out
wrapper generate https://app.example --lang node --source ./out --out ./out/package
# fill in ./out/package/oauthConfig.json with your webapp's OAuth client details
wrapper validate ./out/package
```

The package directory (`./out/package`) contains:

- `tools.json` — the MCP tool definitions (identical across languages).
- `package-manifest.json` — target language, runtime version, deployment modes, runtime policy.
- `oauthConfig.json` — OAuth client config you fill in (no secrets stored).
- `tool-scope.json` — which tools are in the served scope (mutating tools only if you passed
  `--include-mutating`).

### 2. How the agent launches it

An MCP client launches the server over **stdio** by spawning the `serve` command:

```bash
wrapper serve ./out/package --mode stdio
```

Under the hood `serve` dispatches to the runtime recorded in the package's `targetLanguage`:

| targetLanguage | Command the client effectively runs |
|----------------|-------------------------------------|
| `node`   | `node <repo>/runtimes/node/dist/server.js <package-dir> --mode stdio` |
| `python` | `python3 -m wrapper_runtime.server <package-dir> --mode stdio` |
| `java`   | `java -cp <repo>/runtimes/java/target/classes wrapper.Server <package-dir> --mode stdio` |

You can point the client at either the `wrapper serve` wrapper command **or** the underlying runtime
command directly — both start the same stdio MCP server.

### 3. Agent-specific configuration

Below, `WRAPPER` is the absolute path to this repo and `PACKAGE` the absolute path to your generated
package (e.g. `/home/you/webapp-mcp-wrapper` and `/home/you/out/package`).

#### Claude Desktop / Claude Code

Add to the MCP config (`claude_desktop_config.json`, or `.mcp.json` for Claude Code):

```json
{
  "mcpServers": {
    "my-webapp": {
      "command": "wrapper",
      "args": ["serve", "PACKAGE", "--mode", "stdio"]
    }
  }
}
```

If `wrapper` isn't on PATH, use the explicit form:

```json
{
  "mcpServers": {
    "my-webapp": {
      "command": "node",
      "args": ["WRAPPER/core/dist/cli/index.js", "serve", "PACKAGE", "--mode", "stdio"]
    }
  }
}
```

#### Cursor

`.cursor/mcp.json` in your project (or the global Cursor MCP settings) uses the same shape:

```json
{
  "mcpServers": {
    "my-webapp": {
      "command": "node",
      "args": ["WRAPPER/core/dist/cli/index.js", "serve", "PACKAGE", "--mode", "stdio"]
    }
  }
}
```

#### Kiro

`.kiro/settings/mcp.json` (workspace) or `~/.kiro/settings/mcp.json` (user):

```json
{
  "mcpServers": {
    "my-webapp": {
      "command": "node",
      "args": ["WRAPPER/core/dist/cli/index.js", "serve", "PACKAGE", "--mode", "stdio"],
      "disabled": false
    }
  }
}
```

#### Any other MCP-compatible client (stdio)

Configure a stdio server with:

- **command**: `node`
- **args**: `["WRAPPER/core/dist/cli/index.js", "serve", "PACKAGE", "--mode", "stdio"]`

#### Hosted mode (Streamable HTTP)

For a hosted deployment multiple agents can reach over HTTP, run:

```bash
wrapper serve PACKAGE --mode streamable-http --port 8080 --redirect-uri https://you.example/callback
```

Then point HTTP-capable MCP clients at `http://<host>:8080/`. This uses the current MCP Streamable
HTTP transport (never the deprecated HTTP+SSE transport).

### 4. Authentication to the wrapped webapp

Runtime auth uses **OAuth 2.1 + PKCE**:

- **stdio / local**: a `127.0.0.1` loopback redirect — a browser window opens for authorization on
  first tool call.
- **streamable-http / hosted**: the public `--redirect-uri` you configured.

Tokens are stored in the OS keychain (local) or an AES-GCM encrypted file (hosted) and never appear
in logs, reports, or config. For webapps without OAuth, set `oauthConfig.fallback.mode` to
`"api-key"` and supply the key at runtime via the `WRAPPER_API_KEY` environment variable.

### 5. Safety note for agents

Mutating (state-changing) tools are **excluded from the served scope by default**. Only pass
`--include-mutating` at generation time if you explicitly want the agent to be able to change state.
Every tool carries the MCP `readOnlyHint` / `destructiveHint` / `idempotentHint` annotations so the
agent can reason about side effects.

---

## Path B — Let an AI agent build the server via the Skill

The Skill (`core/src/skill/SKILL.md`) is a plain, agent-facing instructions document — not a
product-specific plugin — so any agent that can read instructions and run shell commands can drive
it. The wrapper itself holds **no LLM credentials**; the intelligence stays entirely in the agent.

### Load the Skill

- **Claude Code / skills-aware agents**: copy or symlink `core/src/skill/SKILL.md` into the agent's
  skills directory (e.g. `.claude/skills/webapp-to-mcp-wrapper/SKILL.md`).
- **Cursor / Kiro / generic agents**: add the contents of `SKILL.md` to the agent's rules/steering,
  or paste it into the conversation as the system/really-long instruction, then give the agent the
  webapp URL.

### What the agent does

Given only a webapp URL, an agent with the Skill loaded will:

1. Collect inputs conversationally (URL, auth mechanism, target language, tool scope).
2. Run `extract`.
3. Investigate any skipped/ambiguous item, write an override file, run `apply-overrides` (which
   makes a real verification call before promoting each item).
4. Run `generate --lang <chosen>` (`--include-mutating` only if you opted in).
5. Run `validate`; on failure, perform **one** automatic remediation-and-retest cycle before
   reporting back.
6. Hand you a ready, validated package — with no CLI commands typed by you.

> The CLI refuses to start if an LLM/AI-provider API key is present in its environment
> (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.) — this is intentional (the agent supplies the
> intelligence, the tool never holds model credentials).

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `wrapper: command not found` | Run `npm link` in `core/`, or invoke `node core/dist/cli/index.js`. |
| Crawl hangs / Playwright errors | Set `WRAPPER_FORCE_HTTP_FETCHER=1` for server-rendered targets. |
| Agent lists no tools | Confirm `tools.json` exists in the package and at least one tool is in `tool-scope.json`. |
| Mutating tool missing | Regenerate with `--include-mutating` (only if you intend the agent to change state). |
| `validate` exits 6 | A tool failed; check `validation-run.json` in the package, fix `oauthConfig.json` or an override, regenerate, re-validate. |
| Refuses to start citing an LLM credential | Unset the offending API key env var (FR-024). |

## Command reference

| Command | Purpose | Exit codes |
|---------|---------|------------|
| `wrapper extract <url>` | Discover functionality → Extraction Report | 0 ok · 1 unreachable · 2 args |
| `wrapper apply-overrides <url> <file>` | Resolve ambiguous items with verified overrides | 0 ok · 3 no run · 4 schema invalid |
| `wrapper generate <url> --lang <node\|python\|java>` | Produce an installable package | 0 ok · 3 no run · 5 bad lang |
| `wrapper validate <package-dir>` | Exercise the package end-to-end | 0 ready · 6 failed |
| `wrapper serve <package-dir> --mode <stdio\|streamable-http>` | Run the server | — |
| `wrapper refresh <url>` | Re-extract + regenerate, flagging changes | 0 ok · 1 unreachable |
