#!/usr/bin/env bash
# Install the webapp-to-mcp-wrapper Skill (and optional MCP tools) into a workspace,
# using the same project layout as skills.sh (canonical copy + per-agent links).
#
# Usage:
#   ./scripts/bash/install-into-workspace.sh [workspace]
#   ./scripts/bash/install-into-workspace.sh --workspace /path/to/app --agents cursor,claude-code,kiro-cli
#
# Equivalent skills.sh invocation this script mirrors:
#   npx skills add <this-repo> --skill webapp-to-mcp-wrapper -a cursor -a claude-code -a kiro-cli -y
set -euo pipefail

# Resolve through scripts/install-into-workspace.sh -> bash/install-into-workspace.sh
_source="${BASH_SOURCE[0]}"
while [[ -L "$_source" ]]; do
  _dir="$(CDPATH="" cd "$(dirname "$_source")" && pwd)"
  _source="$(readlink "$_source")"
  [[ "$_source" == /* ]] || _source="$_dir/$_source"
done
SCRIPT_DIR="$(CDPATH="" cd "$(dirname "$_source")" && pwd)"
REPO_ROOT="$(CDPATH="" cd "$SCRIPT_DIR/../.." && pwd)"
SKILL_NAME="webapp-to-mcp-wrapper"
SOURCE_SKILL_DIR="$REPO_ROOT/skills/${SKILL_NAME}"
SOURCE_SKILL_MD="$REPO_ROOT/core/src/skill/SKILL.md"

WORKSPACE=""
AGENTS="cursor,claude-code,kiro-cli"
COPY=false
GLOBAL=false
USE_SKILLS_CLI=false
MCP=false
PACKAGE_DIR=""
YES=false

usage() {
  cat <<'EOF'
Install the webapp-to-mcp-wrapper Skill (and optional MCP tools) into a workspace.

Usage:
  install-into-workspace.sh [workspace] [options]

Arguments:
  workspace                 Target project directory (default: current directory)

Options:
  --workspace, -w PATH      Target project directory
  --agents LIST             Comma-separated agents (default: cursor,claude-code,kiro-cli)
                            Known: cursor, claude-code, kiro-cli, agents, copilot
  --copy                    Copy files instead of symlinking agent dirs to the canonical skill
  --global, -g              Install into user-global skill dirs (~) instead of the workspace
  --use-skills-cli          Prefer `npx skills add` (skills.sh) when available; fall back to native
  --mcp                     Also register MCP tools in .cursor/mcp.json and .mcp.json
  --package DIR             Generated wrapper package to serve via MCP (required with --mcp)
  --yes, -y                 Non-interactive (reserved; this script never prompts)
  --help, -h                Show this help

Layout (project scope, matching skills.sh):
  <workspace>/.agents/skills/webapp-to-mcp-wrapper/   canonical skill (SKILL.md + scripts/)
  <workspace>/.cursor/skills/webapp-to-mcp-wrapper    Cursor (also used by Spec Kit in this repo)
  <workspace>/.claude/skills/webapp-to-mcp-wrapper    Claude Code
  <workspace>/.kiro/skills/webapp-to-mcp-wrapper      Kiro CLI

MCP tools (--mcp --package DIR) add a stdio server named "webapp-mcp-wrapper" without
copying or printing any existing credentials.
EOF
}

die() {
  echo "error: $*" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --workspace|-w)
      [[ $# -ge 2 ]] || die "--workspace requires a path"
      WORKSPACE="$2"
      shift 2
      ;;
    --agents)
      [[ $# -ge 2 ]] || die "--agents requires a list"
      AGENTS="$2"
      shift 2
      ;;
    --copy)
      COPY=true
      shift
      ;;
    --global|-g)
      GLOBAL=true
      shift
      ;;
    --use-skills-cli)
      USE_SKILLS_CLI=true
      shift
      ;;
    --mcp)
      MCP=true
      shift
      ;;
    --package)
      [[ $# -ge 2 ]] || die "--package requires a directory"
      PACKAGE_DIR="$2"
      shift 2
      ;;
    --yes|-y)
      YES=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    -*)
      die "unknown option: $1"
      ;;
    *)
      if [[ -z "$WORKSPACE" ]]; then
        WORKSPACE="$1"
        shift
      else
        die "unexpected argument: $1"
      fi
      ;;
  esac
done

if [[ -z "$WORKSPACE" ]]; then
  WORKSPACE="$(pwd)"
fi
WORKSPACE="$(CDPATH="" cd "$WORKSPACE" && pwd)" || die "workspace does not exist: $WORKSPACE"

[[ -f "$SOURCE_SKILL_MD" ]] || die "missing skill source: $SOURCE_SKILL_MD"
mkdir -p "$SOURCE_SKILL_DIR/scripts"
if [[ ! -e "$SOURCE_SKILL_DIR/SKILL.md" ]]; then
  ln -sfn "$SOURCE_SKILL_MD" "$SOURCE_SKILL_DIR/SKILL.md"
fi
chmod +x "$SOURCE_SKILL_DIR/scripts/wrapper"

agent_project_dir() {
  case "$1" in
    cursor) echo ".cursor/skills" ;;
    claude-code) echo ".claude/skills" ;;
    kiro-cli) echo ".kiro/skills" ;;
    agents|amp|codex|cline) echo ".agents/skills" ;;
    copilot|github-copilot) echo ".agents/skills" ;;
    *) return 1 ;;
  esac
}

agent_global_dir() {
  case "$1" in
    cursor) echo "$HOME/.cursor/skills" ;;
    claude-code) echo "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills" ;;
    kiro-cli) echo "$HOME/.kiro/skills" ;;
    agents|amp|codex|cline) echo "${XDG_CONFIG_HOME:-$HOME/.config}/agents/skills" ;;
    copilot|github-copilot) echo "$HOME/.copilot/skills" ;;
    *) return 1 ;;
  esac
}

IFS=',' read -r -a AGENT_LIST <<< "$AGENTS"
declare -a RESOLVED_AGENTS=()
for raw in "${AGENT_LIST[@]}"; do
  agent="$(echo "$raw" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  [[ -n "$agent" ]] || continue
  if ! agent_project_dir "$agent" >/dev/null; then
    die "unsupported agent: $agent (supported: cursor, claude-code, kiro-cli, agents, copilot)"
  fi
  RESOLVED_AGENTS+=("$agent")
done
[[ ${#RESOLVED_AGENTS[@]} -gt 0 ]] || die "no agents selected"

link_or_copy() {
  local src="$1"
  local dest="$2"
  mkdir -p "$(dirname "$dest")"
  rm -rf "$dest"
  if [[ "$COPY" == true ]]; then
    mkdir -p "$dest"
    cp -a "$src/." "$dest/"
  else
    ln -sfn "$src" "$dest"
  fi
}

write_wrapper_root() {
  local dest="$1"
  printf '%s\n' "$REPO_ROOT" > "$dest/WRAPPER_ROOT"
}

install_canonical() {
  local dest="$1"
  mkdir -p "$dest"
  # Always materialize SKILL.md + scripts so agent loaders do not have to follow a repo-relative link.
  cp -a "$SOURCE_SKILL_MD" "$dest/SKILL.md"
  mkdir -p "$dest/scripts"
  cp -a "$SOURCE_SKILL_DIR/scripts/wrapper" "$dest/scripts/wrapper"
  chmod +x "$dest/scripts/wrapper"
  write_wrapper_root "$dest"
}

try_skills_cli() {
  [[ "$USE_SKILLS_CLI" == true ]] || return 1
  [[ "$GLOBAL" == false ]] || return 1
  command -v npx >/dev/null 2>&1 || return 1

  local -a agent_args=()
  local agent
  for agent in "${RESOLVED_AGENTS[@]}"; do
    agent_args+=(--agent "$agent")
  done

  echo "Trying skills.sh CLI: npx skills add $REPO_ROOT --skill $SKILL_NAME ${agent_args[*]} -y"
  (
    CDPATH="" cd "$WORKSPACE"
    npx --yes skills add "$REPO_ROOT" --skill "$SKILL_NAME" "${agent_args[@]}" -y
  )
}

if [[ "$MCP" == true ]]; then
  [[ -n "$PACKAGE_DIR" ]] || die "--mcp requires --package <generated-package-dir>"
  PACKAGE_DIR="$(CDPATH="" cd "$PACKAGE_DIR" && pwd)" || die "package dir does not exist: $PACKAGE_DIR"
  [[ -f "$PACKAGE_DIR/package-manifest.json" ]] || die "not a generated package (missing package-manifest.json): $PACKAGE_DIR"
  [[ -f "$REPO_ROOT/core/dist/cli/index.js" ]] || die "core CLI is not built; run: (cd \"$REPO_ROOT/core\" && npm run build)"
fi

CANONICAL=""
if [[ "$GLOBAL" == true ]]; then
  CANONICAL="$HOME/.agents/skills/$SKILL_NAME"
else
  CANONICAL="$WORKSPACE/.agents/skills/$SKILL_NAME"
fi

installed_via_cli=false
if try_skills_cli; then
  installed_via_cli=true
  if [[ -d "$WORKSPACE/.agents/skills/$SKILL_NAME" ]]; then
    CANONICAL="$WORKSPACE/.agents/skills/$SKILL_NAME"
  fi
  install_canonical "$CANONICAL"
else
  if [[ "$USE_SKILLS_CLI" == true ]]; then
    echo "skills.sh CLI unavailable or failed; installing natively"
  fi
  mkdir -p "$(dirname "$CANONICAL")"
  install_canonical "$CANONICAL"
fi

declare -a INSTALLED=()
for agent in "${RESOLVED_AGENTS[@]}"; do
  if [[ "$GLOBAL" == true ]]; then
    dest="$(agent_global_dir "$agent")/$SKILL_NAME"
  else
    dest="$WORKSPACE/$(agent_project_dir "$agent")/$SKILL_NAME"
  fi
  # Canonical already lives under .agents/skills; skip linking a dir onto itself.
  if [[ "$dest" == "$CANONICAL" ]]; then
    INSTALLED+=("$dest")
    continue
  fi
  link_or_copy "$CANONICAL" "$dest"
  INSTALLED+=("$dest")
done

# Cursor loads project skills from .cursor/skills (Spec Kit uses this path).
# skills.sh uses .agents/skills for --agent cursor; keep both in project scope.
if [[ "$GLOBAL" == false ]]; then
  for agent in "${RESOLVED_AGENTS[@]}"; do
    if [[ "$agent" == "cursor" ]]; then
      extra="$WORKSPACE/.agents/skills/$SKILL_NAME"
      if [[ "$extra" != "$CANONICAL" ]]; then
        link_or_copy "$CANONICAL" "$extra"
        INSTALLED+=("$extra")
      fi
    fi
  done
fi

merge_mcp_config() {
  local file="$1"
  local cli="$REPO_ROOT/core/dist/cli/index.js"
  local pkg="$PACKAGE_DIR"
  python3 - "$file" "$cli" "$pkg" <<'PY'
import json, os, sys
path, cli, pkg = sys.argv[1], sys.argv[2], sys.argv[3]
data = {}
if os.path.exists(path):
    with open(path, encoding="utf-8") as fh:
        raw = fh.read().strip()
        if raw:
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise SystemExit(f"MCP config is not an object: {path}")
servers = data.get("mcpServers")
if servers is None:
    servers = {}
    data["mcpServers"] = servers
if not isinstance(servers, dict):
    raise SystemExit(f"mcpServers is not an object: {path}")
# Preserve any existing servers (including credentials). Only add our entry if absent.
if "webapp-mcp-wrapper" not in servers:
    servers["webapp-mcp-wrapper"] = {
        "command": "node",
        "args": [cli, "serve", pkg, "--mode", "stdio"],
    }
os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
with open(path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2)
    fh.write("\n")
print(path)
PY
}

MCP_FILES=()
if [[ "$MCP" == true && "$GLOBAL" == false ]]; then
  MCP_FILES+=("$(merge_mcp_config "$WORKSPACE/.cursor/mcp.json")")
  MCP_FILES+=("$(merge_mcp_config "$WORKSPACE/.mcp.json")")
fi

echo "Installed skill '$SKILL_NAME'"
echo "  wrapper repo: $REPO_ROOT"
echo "  workspace:    $WORKSPACE"
echo "  canonical:    $CANONICAL"
if [[ "$installed_via_cli" == true ]]; then
  echo "  method:       skills.sh CLI + WRAPPER_ROOT shim"
else
  echo "  method:       native (skills.sh layout)"
fi
echo "  agents:"
for dest in "${INSTALLED[@]}"; do
  echo "    $dest"
done
if [[ ${#MCP_FILES[@]} -gt 0 ]]; then
  echo "  MCP tools:"
  for f in "${MCP_FILES[@]}"; do
    echo "    $f  (server: webapp-mcp-wrapper)"
  done
fi
echo
echo "Invoke the CLI from the workspace with:"
echo "  $CANONICAL/scripts/wrapper extract <url> --out ./out --json"
