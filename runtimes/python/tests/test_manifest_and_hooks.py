"""Python runtime: manifest loading, in-scope filtering, and tool request reconstruction."""
import json
import os
import tempfile

from wrapper_runtime.manifest import in_scope_tools, load_package
from wrapper_runtime.server import tool_to_request


def _write_pkg(dir_path: str) -> None:
    manifest = {
        "webappTargetId": "example.com",
        "sourceRunId": "run-1",
        "targetLanguage": "python",
        "runtimeVersion": "0.1.0",
        "deploymentModes": ["stdio", "streamable-http"],
        "runtimePolicy": {"retry": {"maxAttempts": 3, "backoff": "exponential-jitter"}, "logging": {"structured": True}},
    }
    tools = [
        {
            "name": "get_widgets",
            "description": "List",
            "inputSchema": {"type": "object", "properties": {}},
            "outputSchema": None,
            "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True},
            "includedByDefault": True,
            "sourceIdentityKey": "GET /api/widgets",
        },
        {
            "name": "create_widget",
            "description": "Create",
            "inputSchema": {"type": "object", "properties": {"name": {"type": "string"}}},
            "outputSchema": None,
            "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False},
            "includedByDefault": False,
            "sourceIdentityKey": "POST /api/widgets",
        },
    ]
    with open(os.path.join(dir_path, "package-manifest.json"), "w") as f:
        json.dump(manifest, f)
    with open(os.path.join(dir_path, "tools.json"), "w") as f:
        json.dump(tools, f)
    with open(os.path.join(dir_path, "oauthConfig.json"), "w") as f:
        json.dump({"authorizationEndpoint": "https://x/a", "tokenEndpoint": "https://x/t", "clientId": "c", "redirectMode": "loopback", "scopes": []}, f)


def test_load_and_in_scope():
    with tempfile.TemporaryDirectory() as d:
        _write_pkg(d)
        pkg = load_package(d)
        assert len(pkg.tools) == 2
        scoped = in_scope_tools(pkg.tools)
        # mutating create_widget excluded by default (FR-012)
        assert [t.name for t in scoped] == ["get_widgets"]


def test_tool_to_request_get_and_path():
    with tempfile.TemporaryDirectory() as d:
        _write_pkg(d)
        pkg = load_package(d)
        get_tool = next(t for t in pkg.tools if t.name == "get_widgets")
        url, method = tool_to_request(get_tool, {"q": "abc"}, "https://example.com")
        assert method == "GET"
        assert url.startswith("https://example.com/api/widgets")
        assert "q=abc" in url
