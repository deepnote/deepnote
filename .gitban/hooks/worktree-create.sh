#!/usr/bin/env bash
# WorktreeCreate hook for Claude Code.
#
# Why this exists: Claude Code's built-in `isolation: "worktree"` feature
# creates new worktrees from `origin/<default-branch>` (typically origin/main)
# rather than from the current HEAD. That's fine on a fresh main branch but
# breaks every long-running feature/sprint branch workflow — the agent ends
# up working on stale code that's missing all the sprint's commits, and any
# attempt to merge back either fast-forwards unrelated main commits into the
# sprint branch or forces cherry-picks.
#
# See: https://github.com/anthropics/claude-code/issues/27876
#
# This hook replaces that default. It forks the worktree from the parent
# repository's current HEAD, so whatever branch the dispatcher is on
# (`sprint/<tag>`, `feature/<card-id>`, etc.) is what the worktree starts
# from. Main never enters the picture.
#
# Contract (per Claude Code hook API):
#   stdin   JSON with fields { name, cwd, session_id, ... }
#           `name` is the worktree slug Claude Code selected (e.g. "agent-a1b2c3d4").
#   stdout  Absolute filesystem path of the created worktree — and ONLY that.
#   stderr  Any diagnostic output. Must not leak to stdout, which Claude parses.
#
# Exits non-zero on any failure; Claude Code surfaces the error back to the
# caller and aborts the sub-agent spawn.

set -euo pipefail

INPUT=$(cat)

# Parse the "name" field from the JSON payload. Prefer jq if present (fast,
# correct); fall back to python (guaranteed available on any dev machine
# running this project); last resort is a sed regex that works for the
# alphanumeric-hyphen names Claude Code generates.
if command -v jq >/dev/null 2>&1; then
  NAME=$(printf '%s' "$INPUT" | jq -r '.name')
elif command -v python >/dev/null 2>&1 && python -c "" >/dev/null 2>&1; then
  NAME=$(printf '%s' "$INPUT" | python -c 'import json,sys; print(json.load(sys.stdin).get("name",""))')
elif command -v python3 >/dev/null 2>&1 && python3 -c "" >/dev/null 2>&1; then
  NAME=$(printf '%s' "$INPUT" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("name",""))')
else
  NAME=$(printf '%s' "$INPUT" | sed -n 's/.*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)
fi

if [[ -z "$NAME" || "$NAME" == "null" ]]; then
  echo "worktree-create: stdin JSON missing 'name' field" >&2
  exit 1
fi

# Use CLAUDE_PROJECT_DIR (if set) only as a -C directory hint to git, so the
# actual path string we propagate comes from `git rev-parse --show-toplevel`.
# On Windows, Claude Code sets CLAUDE_PROJECT_DIR in MSYS form (/c/Users/...)
# which it then cannot itself stat() when the hook echoes that same path back
# on stdout — the spawn aborts with "WorktreeCreate hook returned a path that
# is not a directory". `git rev-parse --show-toplevel` always returns the
# host-native form (C:/Users/...) on Windows, and is identical to the input
# form on Linux/macOS. One line, no platform branches, no cygpath dependency.
REPO_ROOT="$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" rev-parse --show-toplevel)"

WORKTREE_PATH="${REPO_ROOT}/.claude/worktrees/${NAME}"
BRANCH_NAME="worktree-${NAME}"

# Always branch from the parent repo's current HEAD — that's the whole point
# of this hook. Resolve it before any fetch so we're tied to the user's
# intent, not the remote.
BASE_REF=$(git -C "$REPO_ROOT" rev-parse HEAD)
BASE_BRANCH=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)

echo "worktree-create: name=$NAME base=$BASE_BRANCH ($BASE_REF) path=$WORKTREE_PATH" >&2

mkdir -p "$(dirname "$WORKTREE_PATH")"

if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  # Branch already exists — reuse it. This supports the dispatcher's
  # recovery paths after a crashed session.
  git -C "$REPO_ROOT" worktree add "$WORKTREE_PATH" "$BRANCH_NAME" >&2
else
  git -C "$REPO_ROOT" worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" "$BASE_REF" >&2
fi

# stdout must be ONLY the absolute path. Native path separators for the OS.
printf '%s' "$WORKTREE_PATH"
