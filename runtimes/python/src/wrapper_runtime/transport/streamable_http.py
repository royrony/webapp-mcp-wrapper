"""T064: `serve --mode streamable-http` for the Python runtime (FR-015, FR-016).

Runs the generated package as a hosted service using the official MCP Python SDK's Streamable
HTTP transport (never the deprecated HTTP+SSE transport — Constitution Principle I). The SDK
import is deferred so this module imports without the SDK installed.
"""
from __future__ import annotations

from ..manifest import LoadedPackage
from ..server import register_tools


def serve_streamable_http(pkg: LoadedPackage, port: int, base_url: str) -> int:
    """Start a Streamable HTTP MCP server for the package."""
    try:
        from mcp.server.fastmcp import FastMCP  # type: ignore

        server = FastMCP(f"wrapper-{pkg.manifest['webappTargetId']}")
        register_tools(pkg, server, base_url)
        # FastMCP exposes a streamable-http runner; select it explicitly (not SSE).
        server.run(transport="streamable-http", port=port)
        return 0
    except Exception as exc:  # noqa: BLE001
        import sys

        sys.stderr.write(f"Streamable HTTP transport unavailable ({exc}).\n")
        return 1
