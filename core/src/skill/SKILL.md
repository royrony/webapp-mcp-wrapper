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
- **Authentication mechanism** — how the wrapped webapp authenticates callers (OAuth is the primary
  path; API-key/device-code are documented fallbacks). If discovery needs an authenticated session,
  ask for a captured session file for `--auth-session`.
- **Target language** — `node`, `python`, or `java` (FR-018). All three produce an identical tool
  set; the choice is a deployment preference.
- **Tool scope** — read-only only (default, safest), or include mutating tools. This maps to whether
  you pass `--include-mutating` to `generate`.

## 2. Extract

```
wrapper extract <url> --out ./out --json
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
wrapper generate <url> --lang <chosen> --source ./out --out ./out/package [--include-mutating]
```

Pass `--include-mutating` only if the collected tool scope said so.

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

`validate` never invokes a tool outside the user's chosen scope (FR-022), and exercises the OAuth
flow plus a forced transient failure to confirm retry/logging fired.

## 6. Report back

Tell the user either:

- the path to the ready, validated package and how to `serve` it (`wrapper serve ./out/package
  --mode stdio`), or
- the single unresolved issue you could not fix after one remediation cycle, with the evidence from
  the `ValidationRun`.

## Guardrails

- **Never** set an LLM/AI-provider API key in the wrapper's environment — the CLI will refuse to
  start (FR-024). Your model access stays entirely on your side.
- Respect safety-by-default: do not pass `--include-mutating` unless the user explicitly opted in.
- Do a single remediation cycle, not an unbounded loop.
