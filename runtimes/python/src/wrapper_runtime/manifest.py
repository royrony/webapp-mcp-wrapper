"""Manifest loading for the Python runtime (mirrors runtimes/node/src/manifest.ts)."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any


@dataclass
class ToolDefinition:
    name: str
    description: str
    inputSchema: dict[str, Any]
    outputSchema: dict[str, Any] | None
    annotations: dict[str, bool]
    includedByDefault: bool
    sourceIdentityKey: str

    @staticmethod
    def from_dict(d: dict[str, Any]) -> "ToolDefinition":
        return ToolDefinition(
            name=d["name"],
            description=d["description"],
            inputSchema=d["inputSchema"],
            outputSchema=d.get("outputSchema"),
            annotations=d["annotations"],
            includedByDefault=d["includedByDefault"],
            sourceIdentityKey=d["sourceIdentityKey"],
        )


@dataclass
class LoadedPackage:
    dir: str
    manifest: dict[str, Any]
    tools: list[ToolDefinition]
    oauth_config: dict[str, Any]
    scope: list[str] | None


def load_package(dir_path: str) -> LoadedPackage:
    with open(os.path.join(dir_path, "package-manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    with open(os.path.join(dir_path, "tools.json"), encoding="utf-8") as f:
        tools = [ToolDefinition.from_dict(t) for t in json.load(f)]
    with open(os.path.join(dir_path, "oauthConfig.json"), encoding="utf-8") as f:
        oauth = json.load(f)
    scope: list[str] | None = None
    try:
        with open(os.path.join(dir_path, "tool-scope.json"), encoding="utf-8") as f:
            scope = json.load(f).get("tools")
    except (OSError, json.JSONDecodeError):
        scope = None
    return LoadedPackage(dir=dir_path, manifest=manifest, tools=tools, oauth_config=oauth, scope=scope)


def in_scope_tools(tools: list[ToolDefinition], scope: list[str] | None = None) -> list[ToolDefinition]:
    """Tools in the served scope: the tool-scope.json set when present, else includedByDefault."""
    if scope is not None:
        return [t for t in tools if t.name in scope]
    return [t for t in tools if t.includedByDefault]
