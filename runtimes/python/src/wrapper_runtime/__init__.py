"""Python peer runtime for generated MCP server packages.

Reads the language-neutral package (tools.json / package-manifest.json /
oauthConfig.json) the shared core generated and serves it via the official MCP
Python SDK. Behavior (tool set, classification, retry/logging, auth) mirrors the
Node and Java runtimes by construction; the cross-language conformance suite
asserts parity.
"""

__all__ = ["manifest", "reliability", "server"]
