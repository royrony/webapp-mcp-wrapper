---
name: "webapp-to-mcp-wrapper"
description: "Drive the Webapp-to-MCP Wrapper CLI end-to-end from a webapp URL to a validated, installable MCP server package — collecting inputs conversationally, resolving ambiguous extraction items with verified overrides, and validating the result. The wrapper holds no LLM credentials; all judgment comes from you, the driving agent."
user-invocable: true
---

# Webapp-to-MCP Wrapper Skill (User Story 2, FR-019–FR-023)

You are driving the `wrapper` CLI on the user's behalf. The human should never have to type a CLI
command themselves. Your intelligence supplies the judgment the deterministic CLI cannot: choosing
inputs, investigating ambiguous items, and deciding what to try on a remediation retry.

## CLI location

Prefer the skill-local shim (installed next to this file) so the target workspace does not need
`wrapper` on PATH:

```
<this-skill>/scripts/wrapper <command> ...
```

The shim reads `WRAPPER_ROOT` from the skill directory (written by `install-into-workspace.sh`) or
from the `WRAPPER_ROOT` environment variable. Equivalent direct invocation:

```
node $WRAPPER_ROOT/core/dist/cli/index.js <command> ...
```

If neither is available, `wrapper` on PATH is acceptable.

## 1. Collect inputs conversationally (FR-019)

Before running anything, gather (asking the user, or choosing a reasonable default and stating it):

- **Webapp URL** — the entry point to wrap. Required.
- **Authentication strategy** — how the *generated server* will authenticate to the webapp's backend
  at runtime (FR-014). Pick the one that matches the target and pass it at `generate` time via
  `--auth-strategy`:
  - **`session-reuse`** (preferred for cookie/gateway apps): the server reads cookies from a live,
    logged-in Chrome over the DevTools Protocol and attaches them per request; on a 401 it re-reads
    and can reopen the login page (FR-014a). Combine with `--cdp-url http://localhost:9222`. No
    tokens or cookies are ever exported or stored in plaintext.
  - **`oauth`** (default): OAuth 2.1 + PKCE (loopback for stdio, public redirect for hosted).
  - **`api-key`**: a user-supplied key/bearer injected as a header at runtime (`WRAPPER_API_KEY`).
  For **discovery** behind a login, the same live browser is reused via `--cdp-url` (preferred), or a
  captured `--auth-session file.json` of request headers. Never paste secrets into the conversation.
- **Target language** — **Node.js/TypeScript is the only supported runtime.** Python and Java exist
  in-tree but are optional/experimental with no parity guarantee (constitution v1.3.0, Principle VI);
  do not offer them as equivalent choices. Use `--lang node`.
- **Tool scope** — read-only only (default, safest), or include mutating tools. This maps to whether
  you pass `--include-mutating` to `generate`.

> **Multi-host targets (FR-025):** a webapp often serves its UI and its API from different hosts
> (e.g. an SPA at `app.example.com` calling `api.example.com`). Discovery preserves each endpoint's
> origin, and each generated tool calls the host it was observed against — you do not configure a
> single base URL. Cookie/session auth (`session-reuse`) reads cookies for every such host.

## 2. Extract

```
wrapper extract <url> --out ./out --json [--cdp-url http://localhost:9222 | --auth-session session.json]
```

Read the resulting `ExtractionReport`. Note every item whose `mappingStatus` is `skipped` or
`inaccessible`, and its `mappingStatusReason`.

## 3. Resolve ambiguous / skipped items (FR-020)

For each skipped/ambiguous item, investigate it yourself — you have browsing/fetch capability. Once
you understand its real parameters/description/output, write a `resolution-override.schema.json`
file, e.g. `./out/overrides.json`:

```json
[
  {
    "identityKey": "GET /api/report",
    "suppliedBy": "agent",
    "proposedFix": {
      "description": "Returns the daily activity report for a given date",
      "parameters": [{ "name": "date", "type": "string", "required": true, "source": "query" }]
    }
  }
]
```

Then apply it — the CLI makes a **real verification call** per item and only promotes items whose
call succeeds:

```
wrapper apply-overrides <url> ./out/overrides.json --out ./out --json
```

Inspect the per-item `verification.succeeded` in the output. Only verified items become `mapped`.

## 4. Generate

```
wrapper generate <url> --lang node --source ./out --out ./out/package \
  [--auth-strategy session-reuse --cdp-url http://localhost:9222] [--include-mutating]
```

Use `--lang node` (the supported runtime). Choose `--auth-strategy` to match the target
(`session-reuse` for cookie/gateway apps, `oauth` default, or `api-key`). Pass `--include-mutating`
only if the collected tool scope said so.

## 5. Validate (FR-021, FR-022)

```
wrapper validate ./out/package --json
```

Read the `ValidationRun`:

- `overallStatus: "ready"` → the package is good. Report success (step 6).
- `overallStatus: "failed"` → do **one** automatic remediation-and-retest cycle (FR-023): form a
  hypothesis about the failing tool, adjust the relevant override (or regenerate with a different
  scope), re-run `generate`, then run `validate` **once** more. Do not loop indefinitely. Record what
  you tried in the `remediationAttempts` narrative you report back.

`validate` never invokes a tool outside the user's chosen scope (FR-022), and exercises the package's
configured auth strategy plus a forced transient failure to confirm retry/logging fired.

## 6. Report back

Tell the user either:

- the path to the ready, validated package and how to `serve` it (`wrapper serve ./out/package
  --mode stdio`; for a `session-reuse` package add `--cdp-url http://localhost:9222` so the server
  can read the live browser session), or
- the single unresolved issue you could not fix after one remediation cycle, with the evidence from
  the `ValidationRun`.

## Guardrails

- **Never** set an LLM/AI-provider API key in the wrapper's environment — the CLI will refuse to
  start (FR-024). Your model access stays entirely on your side.
- Respect safety-by-default: do not pass `--include-mutating` unless the user explicitly opted in.
- Do a single remediation cycle, not an unbounded loop.
