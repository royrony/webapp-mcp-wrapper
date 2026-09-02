"""T034: Python runtime stdio entrypoint.

Dynamically registers tools from tools.json via the official `mcp` SDK
(FR-005, FR-006; research.md #10). The SDK import is deferred to ``main`` so the
package imports and its dispatch logic is testable without the SDK installed.
"""
from __future__ import annotations

import json
import sys
import time
from typing import Any, Callable
from urllib.parse import quote, urlencode, urlsplit, urlunsplit

from .manifest import LoadedPackage, ToolDefinition, in_scope_tools, load_package
from .reliability import (
    JITTER_FRACTION,
    MAX_ATTEMPTS,
    base_delay_for_attempt,
    is_retryable,
    redact_for_log,
)


def tool_to_request(tool: ToolDefinition, args: dict[str, Any], base_url: str) -> tuple[str, str]:
    """Reconstruct (url, method) for a tool from its sourceIdentityKey ("METHOD /path")."""
    method, path_template = tool.sourceIdentityKey.split(" ", 1)
    filled = path_template
    for k, v in args.items():
        filled = filled.replace("{" + k + "}", quote(str(v)))
    parts = urlsplit(base_url)
    query = ""
    if method == "GET":
        extra = {k: v for k, v in args.items() if "{" + k + "}" not in path_template}
        if extra:
            query = urlencode(extra)
    url = urlunsplit((parts.scheme, parts.netloc, filled, query, ""))
    return url, method


def invoke_with_reliability(
    tool_name: str,
    idempotent: bool,
    call: Callable[[int], tuple[int, Any]],
    *,
    log: Callable[[dict[str, Any]], None] | None = None,
    sleep: Callable[[float], None] | None = None,
) -> dict[str, Any]:
    """Invoke ``call`` with retry/backoff, emitting one structured log record."""
    log = log or (lambda r: sys.stderr.write(json.dumps(r) + "\n"))
    sleep = sleep or time.sleep
    started = time.time()
    attempts = 0
    last_error: str | None = None
    last_status: int | None = None

    for attempt in range(MAX_ATTEMPTS):
        attempts = attempt + 1
        try:
            status, body = call(attempt)
            last_status = status
            if status < 400:
                log({
                    "ts": _now(),
                    "level": "info",
                    "event": "tool_invocation",
                    "toolName": tool_name,
                    "attempts": attempts,
                    "outcome": "success",
                    "durationMs": int((time.time() - started) * 1000),
                })
                return {"ok": True, "status": status, "body": body, "attempts": attempts}
            last_error = f"HTTP {status}"
            if not is_retryable(idempotent=idempotent, status=status) or attempt == MAX_ATTEMPTS - 1:
                break
        except Exception as exc:  # noqa: BLE001 - normalized into a log record
            last_error = redact_for_log(str(exc))
            if not is_retryable(idempotent=idempotent, is_timeout=True) or attempt == MAX_ATTEMPTS - 1:
                break
        import random

        jitter = 1 + (random.random() * 2 - 1) * JITTER_FRACTION
        sleep(base_delay_for_attempt(attempt) * jitter / 1000.0)

    log({
        "ts": _now(),
        "level": "error",
        "event": "tool_invocation",
        "toolName": tool_name,
        "attempts": attempts,
        "outcome": "failure",
        "durationMs": int((time.time() - started) * 1000),
        "error": last_error,
    })
    return {"ok": False, "status": last_status, "error": last_error, "attempts": attempts}


def _now() -> str:
    import datetime

    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def register_tools(pkg: LoadedPackage, server: Any, base_url: str) -> list[ToolDefinition]:
    """Register in-scope tools with an MCP server instance."""
    tools = in_scope_tools(pkg.tools, pkg.scope)
    for tool in tools:
        _register_single(server, tool, base_url)
    return tools


def _register_single(server: Any, tool: ToolDefinition, base_url: str) -> None:
    import urllib.request

    def handler(**args: Any) -> str:
        url, method = tool_to_request(tool, args, base_url)

        def call(_attempt: int) -> tuple[int, Any]:
            req = urllib.request.Request(url, method=method)
            with urllib.request.urlopen(req) as resp:  # noqa: S310 - target is user-provided webapp
                raw = resp.read().decode("utf-8")
                try:
                    return resp.status, json.loads(raw)
                except json.JSONDecodeError:
                    return resp.status, raw

        result = invoke_with_reliability(tool.name, tool.annotations["idempotentHint"], call)
        return json.dumps(result.get("body") if result["ok"] else result.get("error"))

    # The official mcp SDK exposes an add_tool / tool decorator; use whichever exists.
    if hasattr(server, "add_tool"):
        server.add_tool(handler, name=tool.name, description=tool.description)
    elif hasattr(server, "tool"):
        server.tool(name=tool.name, description=tool.description)(handler)


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    if not argv:
        sys.stderr.write("usage: wrapper-runtime-python <package-dir>\n")
        return 2
    pkg = load_package(argv[0])
    base_url = f"https://{pkg.manifest['webappTargetId']}"
    try:
        from mcp.server.fastmcp import FastMCP  # type: ignore

        server = FastMCP(f"wrapper-{pkg.manifest['webappTargetId']}")
        register_tools(pkg, server, base_url)
        server.run()
        return 0
    except Exception as exc:  # noqa: BLE001
        sys.stderr.write(
            f"MCP SDK unavailable or failed to start ({exc}). "
            f"Package loaded with {len(pkg.tools)} tools.\n"
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
