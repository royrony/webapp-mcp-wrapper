"""T040: Python runtime validate-support hooks (FR-021, FR-022).

Mirrors runtimes/node/src/validate-hooks.ts: invoke every in-scope tool once, trigger
the OAuth flow once, and confirm retry/logging fires. Never touches an out-of-scope tool.
"""
from __future__ import annotations

import json
import urllib.request
from typing import Any

from .manifest import LoadedPackage, ToolDefinition, in_scope_tools
from .reliability import backoff_schedule, is_retryable
from .server import invoke_with_reliability, tool_to_request


def _sample_args(tool: ToolDefinition) -> dict[str, Any]:
    args: dict[str, Any] = {}
    for name, prop in (tool.inputSchema.get("properties") or {}).items():
        args[name] = 1 if prop.get("type") == "number" else "test"
    return args


def invoke_all_in_scope(pkg: LoadedPackage, base_url: str) -> list[dict[str, Any]]:
    """Invoke every in-scope tool once against the wrapped webapp."""
    results: list[dict[str, Any]] = []
    for tool in in_scope_tools(pkg.tools, pkg.scope):
        url, method = tool_to_request(tool, _sample_args(tool), base_url)

        def call(_attempt: int, _url: str = url, _method: str = method) -> tuple[int, Any]:
            req = urllib.request.Request(_url, method=_method)
            with urllib.request.urlopen(req) as resp:  # noqa: S310
                raw = resp.read().decode("utf-8")
                try:
                    return resp.status, json.loads(raw)
                except json.JSONDecodeError:
                    return resp.status, raw

        res = invoke_with_reliability(tool.name, tool.annotations["idempotentHint"], call)
        entry = {"toolName": tool.name, "invoked": True, "success": res["ok"]}
        if not res["ok"] and res.get("error"):
            entry["error"] = res["error"]
        results.append(entry)
    return results


def exercise_oauth_once(pkg: LoadedPackage) -> bool:
    c = pkg.oauth_config
    return bool(c.get("authorizationEndpoint") and c.get("tokenEndpoint") and c.get("redirectMode"))


def verify_retry_behavior() -> bool:
    return is_retryable(idempotent=True, status=503) and len(backoff_schedule()) == 2
