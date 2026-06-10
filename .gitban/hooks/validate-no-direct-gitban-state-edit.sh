#!/bin/bash
# Validate-at-rest Layer A — PreToolUse hook (ADR-045 + ADR-054).
#
# Blocks Write/Edit/PowerShell/NotebookEdit/Bash tool calls that mutate
# *hard-protected* gitban state directly. Emits stderr advisories (never
# blocks) for *soft-protected* paths. Ignores *unprotected* paths.
#
# Hard-protected (block):  .gitban/cards/, .gitban/roadmap/, .gitban/audit/
#                          (cards/archive/ inherits)
# Soft-protected (warn):   .gitban/templates/, .gitban/handle.json,
#                          .gitban/validation_config.json, *.example.{json,yaml},
#                          .gitban/examples/
# Unprotected (silent):    everything else under .gitban/ — hooks, logs,
#                          traces, views, user_config.json, AND
#                          .gitban/agents/*/inbox/ (per nf9oid Issue 1; inbox
#                          files are written by the dispatcher and the agent's
#                          own runtime — treating them as hard-protected
#                          blocks legitimate executor close-out).
#
# This hook sources the canonical command-input parser library shipped by
# SCAFREL1:2 (`lib/gitban-hook-input.sh`). The refactor closes four
# production-reported defects:
#   - 2yj6gw  (Windows JSON-escaped path matched literal `\\` only) — fixed
#             via gitban_decode_file_path returning the decoded filesystem
#             path before classification.
#   - 6tucn3 Defect 1 (git add of an MCP-written file blocked) — fixed via
#             gitban_classify_git_subcommand's verb-allowlist of read/meta
#             subcommands; `add` and `commit` are allowed verbs.
#   - 6tucn3 Defect 2 (PARENT="$(...)"; git -C "$PARENT" ... blocked) — fixed
#             via gitban_first_command_token correctly identifying `git` as
#             the second pipeline segment's first command token.
#   - hziixt  (Windows fail-open) — fixed indirectly via library's CRLF
#             normalisation and python-fallback decode chain (no CRLF shebang
#             when the scaffold writes the file via Python on Windows; the
#             library does not depend on `jq`).
#
# Escape: no env-var hatch. Operators call
#   mcp__gitban__allow_hook_bypass_once(
#       hook_name="validate-no-direct-gitban-state-edit",
#       target=...,
#       reason=...,
#   )
# to install a single-use sentinel. The sentinel implementation lands in
# SCAFREL1:6; the library exposes a stub today so the bypass path is
# pre-wired.

set -u

LIB_DIR="$(cd "$(dirname "$0")" && pwd)/lib"
# shellcheck source=lib/gitban-hook-input.sh disable=SC1091
. "$LIB_DIR/gitban-hook-input.sh"

# Wire up hook-invocation audit. The EXIT trap installed here emits exactly
# one row to .gitban/audit/hook_invocations.jsonl per invocation, regardless
# of which exit path the hook takes (SCAFREL1/bgv98b).
gitban_audit_init "validate-no-direct-gitban-state-edit" ""

PAYLOAD=$(gitban_read_payload) || exit 0
TOOL_NAME=$(gitban_decode_tool_name "$PAYLOAD")
gitban_audit_set_tool "$TOOL_NAME"

# Dispatch by tool-shape via the shared classifier (ADR-054 §Decision 1 +
# SCAFREL1/45r1u4). The library owns the tool-name -> dispatch-branch table;
# both validate-no-direct-* hooks read from this single source of truth so
# the PowerShell-routes-as-command rule (xosv96 B1 / o3z0mx) cannot diverge
# again across hooks.
DISPATCH=$(gitban_classify_tool_dispatch "$TOOL_NAME")

if [ "$DISPATCH" = "discovery" ]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Path-classification helper: returns the MCP-tool suggestion appropriate for
# a hard-protected path. Used only when we emit a block.
# ---------------------------------------------------------------------------
_suggest_mcp_tool() {
  local path="$1"
  case "$path" in
    *.gitban/roadmap/*) echo "mcp__gitban__upsert_roadmap" ;;
    *.gitban/audit/*)   echo "(audit log is write-only via MCP)" ;;
    *.gitban/cards/archive/*)
      echo "mcp__gitban__delete_archive or mcp__gitban__import_archive" ;;
    *)                  echo "mcp__gitban__edit_card or mcp__gitban__create_card" ;;
  esac
}

# ---------------------------------------------------------------------------
# Write / Edit / NotebookEdit — classify the decoded file_path.
#
# PowerShell is intentionally NOT in this branch. PowerShell tool payloads
# carry `tool_input.command`, not `tool_input.file_path`; routing it through
# the file_path decoder returns empty and the hook silently passes (the
# `o3z0mx` defect surface). PowerShell is handled in the Bash branch below,
# which scans the command text for mutation utilities (Set-Content, Out-File,
# Remove-Item, etc.) against hard-protected paths.
# ---------------------------------------------------------------------------
if [ "$DISPATCH" = "file_path" ]; then
    FILE_PATH=$(gitban_decode_file_path "$PAYLOAD")
    if [ -n "$FILE_PATH" ]; then
      NORM=$(gitban_normalize_path "$FILE_PATH")
      tier=$(gitban_classify_protected_path "$NORM")
      if [ "$tier" = "hard" ]; then
        if gitban_check_bypass_sentinel "validate-no-direct-gitban-state-edit" "$NORM"; then
          gitban_audit_consumed_append "" "validate-no-direct-gitban-state-edit" "$NORM"
          gitban_audit_mark_bypass "" "$NORM"
          exit 0
        fi
        suggestion=$(_suggest_mcp_tool "$NORM")
        gitban_audit_mark_block "$NORM"
        gitban_emit_block \
          "direct $TOOL_NAME on hard-protected gitban state" \
          "$NORM" \
          "$suggestion (or mcp__gitban__allow_hook_bypass_once(hook_name=\"validate-no-direct-gitban-state-edit\", target=\"$NORM\", reason=\"...\"))"
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
# Command-bearing tools (Bash, PowerShell) — tokenise first; ask "is every
# pipeline segment a `git` invocation?". If yes, classify the git subcommand
# of each segment and allow when every subcommand is read/meta-class OR is an
# allowed write-verb (add, commit, tag, push -- restricted further by
# ADR-051's cwd-pin hook). The classification source-of-truth lives in the
# library; this hook only composes it.
# ---------------------------------------------------------------------------
if [ "$DISPATCH" = "command" ]; then
  # SCAFREL1/45r1u4 L3: explicitly unset the fallthrough-state variable at
  # branch entry. Today's exec'd-hook model makes leakage impossible (a fresh
  # subshell per invocation), but a future source-for-unit-tests refactor
  # would stale-read whatever the previous test set. The unset is cheap and
  # documents the contract: this variable is owned by this branch, nothing
  # outside it should observe a value from a prior invocation.
  unset _FALLTHROUGH_GIT_WRITE

  COMMAND=$(gitban_decode_command "$PAYLOAD")
  [ -z "$COMMAND" ] && exit 0

  # Determine whether every pipeline segment is a `git` invocation. If so,
  # we apply the git-verb allowlist; otherwise we fall through to the
  # path-classification mutation check.
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
    # Extract the git subcommand of each segment. The segment is everything
    # between separators; the subcommand is the first non-flag token after
    # `git`. The library's `gitban_first_command_token` already strips
    # VAR=value assignments and gives us `git`; we need the next token in
    # each segment for the subcommand. Use a small awk pass to extract it.
    SUBCMDS=$(printf '%s' "$COMMAND" | sed -E '
        :a
        s/"[^"]*"/QUOTEDARG/g
        t a
        :b
        s/'\''[^'\'']*'\''/QUOTEDARG/g
        t b
        :c
        s/\$\([^()]*\)/CMDSUB/g
        t c
        :d
        s/`[^`]*`/CMDSUB/g
        t d
      ' \
      | sed -E 's/(&&|\|\|)/\n/g; s/[|;]/\n/g' \
      | awk '
          {
            sub(/^[[:space:]]+/, "")
            while (match($0, /^[A-Za-z_][A-Za-z0-9_]*=/) > 0) {
              sub(/^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+)[[:space:]]*/, "")
            }
            if ($1 == "git") {
              # Walk past flags (-C DIR, -c key=val, --git-dir=...) until we
              # hit the subcommand.
              i = 2
              while (i <= NF) {
                tok = $i
                if (tok == "-C" || tok == "-c") { i += 2; continue }
                if (substr(tok, 1, 1) == "-") { i += 1; continue }
                print tok
                break
              }
            }
          }
        '
    )

    ALL_NONWRITE=1
    FIRST_WRITE=""
    while IFS= read -r sub; do
      [ -z "$sub" ] && continue
      class=$(gitban_classify_git_subcommand "$sub")
      case "$class" in
        read|meta)
          ;;
        write)
          # Allowlist: `add`, `commit`, `tag` are legitimate post-MCP
          # operations that DO mutate the index/refs but DO NOT mutate
          # working-tree content — they only record content the MCP server
          # has already written. Other write verbs fall through.
          case "$sub" in
            add|commit|tag)
              ;;
            *)
              ALL_NONWRITE=0
              FIRST_WRITE="$sub"
              break
              ;;
          esac
          ;;
      esac
    done <<< "$SUBCMDS"

    if [ "$ALL_NONWRITE" = "1" ]; then
      exit 0
    fi
    # Otherwise: fall through to path-classification mutation check.
    # (E.g. `git rm .gitban/cards/foo.md` — rm IS a write verb that mutates
    # the working tree; we want to block it on hard-protected paths.)
    _FALLTHROUGH_GIT_WRITE="$FIRST_WRITE"
  fi

  # Path-classification mutation check.
  #
  # Path extraction runs against the MASKED command so that `.gitban/...`
  # literals inside quoted strings, heredoc bodies, $(...) and backticks
  # (e.g. a commit message body that mentions an audit-log filename in
  # prose) do NOT leak into the path set and trigger false-positive blocks.
  # Earlier omission produced a real failure mode: a commit message
  # mentioning `.gitban/audit/hook_invocations.jsonl,` in its prose body
  # caused the extractor to grab the comma-suffixed string as a path; the
  # block message even surfaced the trailing comma in its own
  # `mcp__gitban__allow_hook_bypass_once(... target="...,")` suggestion,
  # locking the operator into a confusing comma-mismatched sentinel target.
  #
  # The trailing-punctuation `sed` strips characters that can prefix-match
  # the path-extractor regex's character class but cannot legitimately
  # terminate a filesystem path: `,.:;!?)]}>` (prose punctuation). This is
  # defense-in-depth against multi-line quoted strings the line-bound Phase 2
  # sed masker still cannot neutralise — see gitban-hook-input.sh:
  # gitban_mask_command_text comments.
  MASKED_COMMAND=$(gitban_mask_command_text "$COMMAND")
  PATHS=$(printf '%s' "$MASKED_COMMAND" \
    | grep -oiE '\.gitban[/\\][^[:space:]"'"'"';&|]*' \
    | sed -E 's/[,.:;!?)\]}>]+$//' \
    || true)
  HAS_HARD=0
  HAS_SOFT=0
  HARD_HIT=""
  SOFT_HIT=""
  for p in $PATHS; do
    [ -z "$p" ] && continue
    norm=$(gitban_normalize_path "$p")
    case "$(gitban_classify_protected_path "$norm")" in
      hard) HAS_HARD=1; HARD_HIT="$norm" ;;
      soft) HAS_SOFT=1; SOFT_HIT="$norm" ;;
    esac
  done

  if [ "$HAS_HARD" = "1" ]; then
    if printf '%s' "$COMMAND" | grep -qE '(^|[^2])>[>]?[[:space:]]' \
       || printf '%s' "$COMMAND" | grep -qE '\b(cp|mv|mkdir|touch|tee|chmod|chown|rm|rmdir)\b' \
       || printf '%s' "$COMMAND" | grep -qE '\bsed[[:space:]]+(-[a-zA-Z]*i|-i)\b' \
       || printf '%s' "$COMMAND" | grep -qE '^[[:space:]]*cat[[:space:]]*>[>]?' \
       || printf '%s' "$COMMAND" | grep -qiE '\b(Set-Content|Out-File|Add-Content|New-Item|Move-Item|Copy-Item|Remove-Item|Clear-Content)\b' \
       || [ -n "${_FALLTHROUGH_GIT_WRITE:-}" ]; then
      if gitban_check_bypass_sentinel "validate-no-direct-gitban-state-edit" "$HARD_HIT"; then
        gitban_audit_consumed_append "" "validate-no-direct-gitban-state-edit" "$HARD_HIT"
        gitban_audit_mark_bypass "" "$HARD_HIT"
        exit 0
      fi
      suggestion=$(_suggest_mcp_tool "$HARD_HIT")
      gitban_audit_mark_block "$HARD_HIT"
      gitban_emit_block \
        "Bash command mutates hard-protected gitban state" \
        "$HARD_HIT" \
        "$suggestion (or mcp__gitban__allow_hook_bypass_once(hook_name=\"validate-no-direct-gitban-state-edit\", target=\"$HARD_HIT\", reason=\"...\"))"
    fi
  fi

  if [ "$HAS_SOFT" = "1" ]; then
    if printf '%s' "$COMMAND" | grep -qE '(^|[^2])>[>]?[[:space:]]' \
       || printf '%s' "$COMMAND" | grep -qE '\b(cp|mv|mkdir|touch|tee|chmod|chown|rm|rmdir)\b' \
       || printf '%s' "$COMMAND" | grep -qE '\bsed[[:space:]]+(-[a-zA-Z]*i|-i)\b' \
       || printf '%s' "$COMMAND" | grep -qiE '\b(Set-Content|Out-File|Add-Content|New-Item|Move-Item|Copy-Item|Remove-Item|Clear-Content)\b'; then
      gitban_audit_mark_advisory "$SOFT_HIT"
      gitban_emit_advisory \
        "Bash command touches soft-protected gitban file" \
        "$SOFT_HIT"
    fi
  fi
fi

exit 0
