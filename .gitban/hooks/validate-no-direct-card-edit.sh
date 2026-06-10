#!/bin/bash
# Validate-at-rest — PreToolUse hook (ADR-045 + ADR-054).
#
# Blocks Write/Edit/PowerShell/NotebookEdit/Bash tool calls that mutate a
# *hard-protected* gitban card or roadmap or audit path directly. Sibling hook
# to validate-no-direct-gitban-state-edit.sh; this file exists so the
# `validate-no-direct-card-edit` matcher name documented in earlier scaffolds
# resolves to a real script in fresh `gitban init` workspaces. The two hooks
# share the same library and the same classification regex — both observe the
# same protection tier set.
#
# Sourcing the canonical command-input parser library (ADR-054 §Decision 1)
# fixes the JSON-escape Windows bug (card 2yj6gw), the Git Bash CRLF /
# fail-open shape (card hziixt), and the inbox over-classification
# (card nf9oid Issue 1; HARD_RE in the library no longer includes
# .gitban/agents/<role>/inbox/).
#
# Escape: there is no env-var escape hatch — operators call
# `mcp__gitban__allow_hook_bypass_once(hook_name="validate-no-direct-card-edit",
# target=..., reason=...)` to install a single-use sentinel. The sentinel
# implementation is the library stub today (SCAFREL1:6 ships the full flow);
# this hook is wired for it ahead of time so the bypass becomes available
# without a second refactor.

set -u

# ---------------------------------------------------------------------------
# Library source — resolve sibling lib/ deterministically regardless of CWD
# ---------------------------------------------------------------------------
LIB_DIR="$(cd "$(dirname "$0")" && pwd)/lib"
# shellcheck source=lib/gitban-hook-input.sh disable=SC1091
. "$LIB_DIR/gitban-hook-input.sh"

# Wire up hook-invocation audit. The EXIT trap installed here emits exactly
# one row to .gitban/audit/hook_invocations.jsonl per invocation, regardless
# of which exit path the hook takes (SCAFREL1/bgv98b).
gitban_audit_init "validate-no-direct-card-edit" ""

PAYLOAD=$(gitban_read_payload) || exit 0
TOOL_NAME=$(gitban_decode_tool_name "$PAYLOAD")
gitban_audit_set_tool "$TOOL_NAME"

# Dispatch by tool-shape via the shared classifier (ADR-054 §Decision 1 +
# SCAFREL1/45r1u4). The library owns the tool-name -> dispatch-branch table
# so this hook and validate-no-direct-gitban-state-edit.sh inherit the same
# decision automatically. PowerShell routes to `command` (not `file_path`)
# — see xosv96 B1 / o3z0mx for the original defect surface.
DISPATCH=$(gitban_classify_tool_dispatch "$TOOL_NAME")

if [ "$DISPATCH" = "discovery" ]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# File-path-bearing tools: Write, Edit, NotebookEdit. We trust the library
# decoder to return the actual filesystem path, not the JSON-escaped form —
# that single change closes 2yj6gw.
# ---------------------------------------------------------------------------
if [ "$DISPATCH" = "file_path" ]; then
    FILE_PATH=$(gitban_decode_file_path "$PAYLOAD")
    if [ -n "$FILE_PATH" ]; then
      NORM=$(gitban_normalize_path "$FILE_PATH")
      tier=$(gitban_classify_protected_path "$NORM")
      if [ "$tier" = "hard" ]; then
        # Sentinel check — stub returns 1 today (SCAFREL1:6 finishes it).
        if gitban_check_bypass_sentinel "validate-no-direct-card-edit" "$NORM"; then
          gitban_audit_consumed_append "" "validate-no-direct-card-edit" "$NORM"
          gitban_audit_mark_bypass "" "$NORM"
          exit 0
        fi
        gitban_audit_mark_block "$NORM"
        gitban_emit_block \
          "direct $TOOL_NAME on hard-protected gitban state" \
          "$NORM" \
          "mcp__gitban__allow_hook_bypass_once(hook_name=\"validate-no-direct-card-edit\", target=\"$NORM\", reason=\"...\")"
      elif [ "$tier" = "soft" ]; then
        gitban_audit_mark_advisory "$NORM"
        gitban_emit_advisory \
          "direct $TOOL_NAME on soft-protected gitban file" \
          "$NORM"
      fi
    fi
    exit 0
fi

# ---------------------------------------------------------------------------
# Command-bearing tools (Bash, PowerShell): delegate to the sibling state-edit
# hook semantics by classifying the tokenised first-command-token. If every
# pipeline segment's first token is `git`, allow (the state-edit hook applies
# the verb allowlist; this hook is strictly scoped to direct mutations of card
# paths and never blocks git).
# ---------------------------------------------------------------------------
if [ "$DISPATCH" = "command" ]; then
  COMMAND=$(gitban_decode_command "$PAYLOAD")
  [ -z "$COMMAND" ] && exit 0

  # If every pipeline segment is a `git` invocation, this hook is not the
  # right enforcer — the sibling hook owns git-vs-not-git semantics. We exit 0
  # and let the sibling hook decide.
  ALL_GIT=1
  ANY_TOKEN=0
  while IFS= read -r tok; do
    [ -z "$tok" ] && continue
    ANY_TOKEN=1
    if [ "$tok" != "git" ]; then
      ALL_GIT=0
      break
    fi
  done < <(gitban_first_command_token "$COMMAND")

  if [ "$ANY_TOKEN" = "1" ] && [ "$ALL_GIT" = "1" ]; then
    exit 0
  fi

  # Non-git Bash: scan for .gitban/cards/ or .gitban/roadmap/ or
  # .gitban/audit/ tokens and block on apparent mutation. Cheap heuristic:
  # any redirect-out (`>`/`>>`) or known mutating utility targeting a hard
  # path is a block. Read-only commands (cat, grep, ls, head, tail, wc, diff)
  # are allowed.
  PATHS=$(printf '%s' "$COMMAND" | grep -oiE '\.gitban[/\\][^[:space:]"'"'"';&|]*' || true)
  HAS_HARD=0
  HARD_HIT=""
  for p in $PATHS; do
    [ -z "$p" ] && continue
    norm=$(gitban_normalize_path "$p")
    if [ "$(gitban_classify_protected_path "$norm")" = "hard" ]; then
      HAS_HARD=1
      HARD_HIT="$norm"
      break
    fi
  done

  if [ "$HAS_HARD" = "1" ]; then
    if printf '%s' "$COMMAND" | grep -qE '(^|[^2])>[>]?[[:space:]]' \
       || printf '%s' "$COMMAND" | grep -qE '\b(cp|mv|mkdir|touch|tee|chmod|chown|rm|rmdir)\b' \
       || printf '%s' "$COMMAND" | grep -qE '\bsed[[:space:]]+(-[a-zA-Z]*i|-i)\b' \
       || printf '%s' "$COMMAND" | grep -qE '^[[:space:]]*cat[[:space:]]*>[>]?' \
       || printf '%s' "$COMMAND" | grep -qiE '\b(Set-Content|Out-File|Add-Content|New-Item|Move-Item|Copy-Item|Remove-Item|Clear-Content)\b'; then
      if gitban_check_bypass_sentinel "validate-no-direct-card-edit" "$HARD_HIT"; then
        gitban_audit_consumed_append "" "validate-no-direct-card-edit" "$HARD_HIT"
        gitban_audit_mark_bypass "" "$HARD_HIT"
        exit 0
      fi
      gitban_audit_mark_block "$HARD_HIT"
      gitban_emit_block \
        "Bash command mutates hard-protected gitban state" \
        "$HARD_HIT" \
        "mcp__gitban__allow_hook_bypass_once(hook_name=\"validate-no-direct-card-edit\", target=\"$HARD_HIT\", reason=\"...\")"
    fi
  fi
fi

exit 0
