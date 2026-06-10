#!/bin/bash
# gitban-hook-input.sh — canonical command-input parser library for gitban
# PreToolUse hooks (ADR-054 §Decision 1).
#
# All gitban hooks source this library to share a single implementation of
# JSON decoding, command tokenisation, path classification, bypass-sentinel
# handling, and audit logging. Every per-hook re-derivation of these
# primitives over the last four months has shipped with a bug; the library
# is the structural answer (ADR-054 Rationale §4).
#
# Source it from each hook with:
#
#     LIB_DIR="$(cd "$(dirname "$0")" && pwd)/lib"
#     # shellcheck source=lib/gitban-hook-input.sh
#     . "$LIB_DIR/gitban-hook-input.sh"
#
# Dependencies: pure bash + standard utilities (grep, sed, awk, head, date,
# mkdir, printf). jq is *preferred* for JSON decoding but optional; the
# library falls back to a pure-bash sed extractor for the three fields
# hooks need (`tool_name`, `tool_input.file_path`, `tool_input.command`).
# Python is INTENTIONALLY NOT in the decode chain — every PreToolUse hook
# spawns a fresh subshell, so an in-process interpreter cache is meaningless
# across invocations, and on Windows Git Bash a python spawn carries
# ~13s/call cold-start (whether or not the Microsoft Store stub is bypassed)
# which pushes per-hook wall-time over the test harness's 20s subprocess
# bound. See xosv96 cycle-2 closure for the full rationale.
#
# Cross-platform: tested on Linux, macOS, and Windows Git Bash (MSYS2).
# Audit-log atomicity on Windows/NTFS uses `flock` if available, otherwise
# falls back to per-process JSONL files merged by a background pass.
#
# Public functions:
#   gitban_read_payload                — read stdin to a variable; normalise CRLF.
#   gitban_decode_file_path PAYLOAD    — extract tool_input.file_path (decoded).
#   gitban_decode_command PAYLOAD      — extract tool_input.command (decoded).
#   gitban_decode_tool_name PAYLOAD    — extract tool_name.
#   gitban_tokenize_command COMMAND    — NUL-separated tokens with quote/heredoc masking.
#   gitban_first_command_token COMMAND — first command token of each pipeline segment.
#   gitban_mask_command_text COMMAND   — masked command text (heredoc bodies, single/double/double-quoted strings, $(...) and backticks replaced with placeholders) preserving structure for downstream regex scans.
#   gitban_normalize_path PATH         — canonicalise separators to forward-slash.
#   gitban_classify_protected_path PATH — emit "hard"/"soft"/"unprotected".
#   gitban_classify_git_subcommand SUBCMD — emit "read"/"meta"/"write".
#   gitban_classify_tool_dispatch TOOL_NAME — emit "file_path"/"command"/"discovery".
#   gitban_check_bypass_sentinel HOOK PATH_OR_FP — stub OK; full impl in step 6.
#   gitban_audit_append FILE JSON_ROW  — append JSONL row with concurrency guard + 100MiB rotation.
#   gitban_audit_invocation_append HOOK TOOL CLASS TARGET [SENTINEL_ID] [EXIT_CODE] — canonical hook-invocation row.
#   gitban_audit_consumed_append SENTINEL_ID HOOK PATH — sentinel-consume audit.
#   gitban_emit_block REASON PATH MCP_SUGGESTION  — stderr block + exit 2.
#   gitban_emit_advisory REASON PATH   — stderr warn (no exit).
#   gitban_emit_env_deprecation        — DEPRECATED warning for legacy
#                                        env-var bypasses (ADR-054). Fires
#                                        automatically on library load;
#                                        suppress with
#                                        GITBAN_HOOK_INPUT_SUPPRESS_DEPRECATION=1.
#
# Library version (for self-test handshake):
GITBAN_HOOK_INPUT_LIB_VERSION="0.1.0"

# Idempotent guard. Hooks may source the library in nested calls
# (e.g., hook → helper script → hook). Re-sourcing is harmless but the guard
# documents the contract.
if [ -n "${_GITBAN_HOOK_INPUT_SOURCED:-}" ]; then
  return 0 2>/dev/null || true
fi
_GITBAN_HOOK_INPUT_SOURCED=1

# ---------------------------------------------------------------------------
# Classification regexes (single source of truth — ADR-045 + ADR-051)
# ---------------------------------------------------------------------------

# Hard-protected (block direct writes). Inbox is INTENTIONALLY OMITTED
# (closes nf9oid Issue 1 — see ADR-054 §Out of scope item that pulls the
# correction inside this refactor). Inbox files are written by the
# dispatcher and the agent's own runtime; treating them as hard-protected
# blocks legitimate executor close-out. ADR-034 reconciliation handles the
# longer-term inbox/audit story.
#
# Hard set: cards/ (incl. archive subdir), roadmap/, audit/.
GITBAN_HARD_RE='\.gitban[/\\](cards|roadmap|audit)([/\\]|$)|\.gitban[/\\]cards[/\\]archive([/\\]|$)'

# Soft-protected (warn-not-block). Individual user-config files plus
# templates/examples directories.
GITBAN_SOFT_RE='\.gitban[/\\](templates|examples)([/\\]|$)|\.gitban[/\\](handle\.json|validation_config\.json|scaffold\.example\.yaml|claude-mcp-setup\.example\.json|template_config\.example\.json|validation_config\.example\.json)$'

# Git read-class subcommands (loud-failure-mode on CWD drift, no
# enforcement needed). Per ADR-053 corrigendum: `stash` belongs in read-class
# at the classification layer because the cwd-pin-check refactor in step 4
# needs it included for the same-subcommand-name-as-write reasoning.
# Step 4 will surface `stash <write-verb>` (apply, push, pop, drop, clear,
# create) via a refinement check; the bare classification stays read.
#
# Allowlist widening (2026-05-28): added `check-ignore`, `check-attr`,
# `check-mailmap`, `check-ref-format`, `cherry`, `range-diff`, `shortlog`,
# `verify-commit`, `verify-tag`, `merge-tree`. All are unambiguous read-only
# verbs (introspection, comparison, signature verification, three-way merge
# preview without touching the index). Their failure mode under CWD drift is
# wrong-data-return (loud), not silent-wrong-target — same shape as the
# existing read-class set. Earlier omission caused real-session false
# positives (operators ran `git check-ignore` to debug gitignore coverage
# or `git branch --merged` for cleanup and got blocked).
GITBAN_READ_CLASS_RE='^(log|diff|show|status|for-each-ref|rev-parse|merge-base|cat-file|ls-tree|ls-files|describe|name-rev|blame|grep|fsck|count-objects|var|rev-list|whatchanged|fetch|config|bisect|reflog|annotate|stash|check-ignore|check-attr|check-mailmap|check-ref-format|cherry|range-diff|shortlog|verify-commit|verify-tag|merge-tree)$'

# Git meta-class subcommands (help / version).
GITBAN_META_CLASS_RE='^(--help|--version|version|help)$'

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

# Default rotation threshold (bytes). Files larger than this are renamed to
# `<base>.archived.<ts>.jsonl` before the next append. Operators can override
# with `GITBAN_AUDIT_ROTATE_BYTES` for testing or tighter budgets.
GITBAN_AUDIT_ROTATE_BYTES_DEFAULT=104857600  # 100 MiB

# Best-effort rotation. Renames the audit file when its current size exceeds
# `GITBAN_AUDIT_ROTATE_BYTES` (default 100 MiB). The rename is performed under
# the same flock the append uses so we cannot interleave a rotation with a
# concurrent write on POSIX. On Windows without flock the rotate-and-append
# race is acceptable: at worst one extra row lands in the about-to-be-archived
# file, never lost.
# Never fails the caller — rotation failures are silent.
_gitban_maybe_rotate() {
  local file="$1"
  local limit="${GITBAN_AUDIT_ROTATE_BYTES:-$GITBAN_AUDIT_ROTATE_BYTES_DEFAULT}"
  [ -f "$file" ] || return 0
  local size
  size=$(wc -c < "$file" 2>/dev/null | tr -d ' ')
  [ -n "$size" ] || return 0
  if [ "$size" -ge "$limit" ] 2>/dev/null; then
    local ts
    ts=$(date -u +"%Y%m%dT%H%M%SZ" 2>/dev/null) || ts=$(date +%s)
    local archived="${file%.jsonl}.archived.${ts}.jsonl"
    mv "$file" "$archived" 2>/dev/null || true
  fi
}

# Append a single JSONL row to a file. Atomicity strategy:
#   - POSIX: append-mode write of <= 3500 bytes is atomic for O_APPEND under
#     PIPE_BUF (4096). Truncate longer rows with "...[TRUNCATED]".
#   - Windows/Git Bash: O_APPEND is not atomic; use flock if available;
#     otherwise write to a per-process file. The health_check merge pass
#     consolidates per-process files into the canonical log.
# Never fails the caller — audit failure should not block the hook.
_gitban_atomic_append() {
  local file="$1"
  local row="$2"
  local maxbytes=3500
  local row_len
  row_len=${#row}
  if [ "$row_len" -gt "$maxbytes" ]; then
    row="${row:0:$maxbytes}...[TRUNCATED]"
  fi

  local dir
  dir=$(dirname "$file")
  mkdir -p "$dir" 2>/dev/null || return 0

  # Try flock first (Git Bash usually ships it; coreutils on Linux/macOS).
  if command -v flock >/dev/null 2>&1; then
    {
      flock -w 2 9 || true
      _gitban_maybe_rotate "$file"
      printf '%s\n' "$row" >> "$file"
    } 9>"${file}.lock" 2>/dev/null
    return 0
  fi

  # No flock — on POSIX, plain append is atomic enough for <4KB rows.
  # On Windows without flock, write to a per-process file as a safety net.
  case "$(uname -s 2>/dev/null)" in
    MINGW*|MSYS*|CYGWIN*)
      # Per-pid sidecar; merged into canonical by `health_check`.
      local pid_file="${file%.jsonl}.${$}.jsonl"
      _gitban_maybe_rotate "$pid_file"
      printf '%s\n' "$row" >> "$pid_file" 2>/dev/null || true
      ;;
    *)
      _gitban_maybe_rotate "$file"
      printf '%s\n' "$row" >> "$file" 2>/dev/null || true
      ;;
  esac
}

# Escape a string for safe inclusion in a JSON string literal. Pure bash,
# no jq dependency.
_gitban_json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\t'/\\t}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  printf '%s' "$s"
}

# ISO-8601 UTC timestamp with millisecond precision where supported.
_gitban_timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%S.%3NZ" 2>/dev/null \
    || date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null \
    || date +"%Y-%m-%dT%H:%M:%S"
}

# Read operator handle from .gitban/handle.json (best-effort).
#
# Reuses _gitban_decode_json_field — the same decoder hooks use to parse the
# Claude Code tool payload — instead of an ad-hoc `grep -oE` regex. The
# library's stated mission is "one source of truth for JSON-string decoding";
# the previous inline regex violated that locally (handle.json is operator-
# authored and stable so the risk was low, but mixing decoders is exactly the
# fracture pattern the library was created to eliminate). See SCAFREL1 v9hacf
# review 1 L3.
_gitban_handle() {
  local handle_file=".gitban/handle.json"
  local handle=""
  if [ -f "$handle_file" ]; then
    local payload
    payload=$(cat "$handle_file" 2>/dev/null) || payload=""
    if [ -n "$payload" ]; then
      handle=$(_gitban_decode_json_field "$payload" '.handle' 'handle')
    fi
  fi
  [ -z "$handle" ] && handle="unknown"
  printf '%s' "$handle"
}

# Decode a single JSON-string field. Strategy order:
#   1. Pure-bash parameter expansion (zero forks) — handles unescaped values.
#   2. grep+sed fallback for escaped values (`\"`, `\\`) — one fork pair.
#   3. jq if available and the simpler paths failed (defensive only).
#
# Python is intentionally NOT in the chain (xosv96 cycle-2 B1 defect):
# every PreToolUse hook spawns a fresh subshell with no in-process cache,
# so the previous `_GITBAN_PYTHON_CACHED` was meaningless. On Windows Git
# Bash without jq, each python spawn carries ~13s cold-start, which pushes
# per-hook wall-time over the test harness's 20s subprocess bound. The
# tool_name / file_path / command fields are flat JSON strings with a
# bounded escape vocabulary (`\"`, `\\`, `\n`, `\t`, `\r`); pure-bash
# parameter expansion handles the common case in millisecond-scale wall
# time (no subprocess fork), and the grep+sed fallback covers escapes.
#
# On Windows Git Bash MSYS, every subprocess fork costs ~1.8s of base
# overhead. The bash-param path eliminates those forks entirely for the
# common case (no embedded `\"` in `tool_name`, no embedded `\\` in a
# simple `file_path` like `.gitban/cards/foo.md`). The Edit / Write / Bash
# tool inputs that reach the hook follow this pattern in practice — see
# the test corpus for the shapes the hook actually sees.
#
# Field is given as a jq-path expression like `.tool_input.file_path` and
# the dotted name (`file_path`) for the bash-param/sed forms.
_gitban_decode_json_field() {
  local payload="$1"
  local jq_path="$2"
  local sed_field="$3"   # e.g. "file_path" — used for the bash-param/sed form
  local value=""
  local strategy=""

  # Phase 1 — pure-bash parameter expansion (zero forks). Find `"<field>"`,
  # skip to the value's opening quote, then take everything up to the next
  # unescaped quote. If the value contains an escaped quote (`\"`), the
  # naive `%%\"*` cut would truncate early; we detect that case and fall
  # through to Phase 2.
  local needle="\"$sed_field\""
  local after="${payload#*$needle}"
  if [ "$after" != "$payload" ]; then
    # Skip past colon + optional whitespace + opening quote.
    after="${after#*:}"
    # Strip leading whitespace (spaces and tabs). Bash extglob-free form:
    # take the longest prefix matching ONLY space/tab and remove it.
    local _ws="${after%%[!$' \t']*}"
    after="${after#"$_ws"}"
    if [ "${after#\"}" != "$after" ]; then
      after="${after#\"}"
      # Naive cut to next quote.
      local candidate="${after%%\"*}"
      # Check whether the candidate ends with a backslash (meaning the quote
      # we cut on was escaped). If so, fall through to Phase 2.
      case "$candidate" in
        *\\)
          : # escape present; defer to Phase 2
          ;;
        *)
          # No escape — but the value itself might contain `\n` / `\\` /
          # `\t` / `\r` that we still need to decode. Detect any backslash
          # and run the decode pass; otherwise return as-is.
          case "$candidate" in
            *\\*)
              value=$(printf '%s' "$candidate" | sed -e 's/\\\\/\x01/g' -e 's/\\"/"/g' -e 's/\\n/\n/g' -e 's/\\t/\t/g' -e 's/\\r/\r/g' -e 's|\x01|\\|g')
              ;;
            *)
              value="$candidate"
              ;;
          esac
          strategy="param"
          ;;
      esac
    fi
  fi

  # Phase 2 — grep+sed for escape-bearing values. One fork pair.
  if [ -z "$value" ] && [ "$strategy" != "param" ]; then
    value=$(printf '%s' "$payload" \
      | grep -oE "\"$sed_field\"[[:space:]]*:[[:space:]]*\"(\\\\.|[^\"\\\\])*\"" \
      | head -1 \
      | sed -E "s/^\"$sed_field\"[[:space:]]*:[[:space:]]*\"//;s/\"$//")
    if [ -n "$value" ]; then
      value=$(printf '%s' "$value" | sed -e 's/\\\\/\x01/g' -e 's/\\"/"/g' -e 's/\\n/\n/g' -e 's/\\t/\t/g' -e 's/\\r/\r/g' -e 's|\x01|\\|g')
      strategy="sed"
    fi
  fi

  # Phase 3 — jq as a defensive last resort (only if simpler paths missed).
  if [ -z "$value" ] && command -v jq >/dev/null 2>&1; then
    value=$(printf '%s' "$payload" | jq -r "$jq_path // empty" 2>/dev/null)
    [ -n "$value" ] && strategy="jq"
  fi

  if [ -n "${GITBAN_HOOK_INPUT_TRACE:-}" ] && [ -n "$strategy" ]; then
    echo "gitban-hook-input: decoded $sed_field via $strategy" >&2
  fi

  printf '%s' "$value"
}

# ---------------------------------------------------------------------------
# Public functions
# ---------------------------------------------------------------------------

# Read all of stdin into a variable; normalise CRLF → LF; reject empty.
# Usage:  PAYLOAD=$(gitban_read_payload) || exit 1
gitban_read_payload() {
  local payload
  payload=$(cat)
  if [ -z "$payload" ]; then
    echo "gitban-hook-input: empty stdin payload" >&2
    return 1
  fi
  # CRLF → LF (multi-line JSON payloads with embedded \r\n line endings
  # break grep/sed parsers on POSIX runners that don't expect them).
  payload="${payload//$'\r'/}"
  printf '%s' "$payload"
}

# Decode tool_input.file_path from a JSON payload.
gitban_decode_file_path() {
  _gitban_decode_json_field "$1" '.tool_input.file_path' 'file_path'
}

# Decode tool_input.command from a JSON payload.
gitban_decode_command() {
  _gitban_decode_json_field "$1" '.tool_input.command' 'command'
}

# Decode tool_name from a JSON payload.
gitban_decode_tool_name() {
  _gitban_decode_json_field "$1" '.tool_name' 'tool_name'
}

# Tokenise a bash command string with quote- and heredoc-awareness.
# Output: NUL-separated token list suitable for `while IFS= read -r -d ''`.
# Single-quoted, double-quoted, $(...), backtick, and heredoc body regions
# are masked to placeholders before splitting on shell metacharacters.
# This is the right primitive for "did the user write a `git foo` token?" —
# substrings inside heredocs and quoted strings are masked out.
gitban_tokenize_command() {
  local cmd="$1"

  # Mask heredoc bodies first. Pattern: `<<-?'?WORD'?` introduces a heredoc;
  # body ends at a line whose only content is `WORD` (optionally preceded by
  # a tab when `<<-` is used). We scan line-by-line.
  local masked=""
  local in_heredoc=0
  local heredoc_marker=""
  local heredoc_dash=0
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    if [ "$in_heredoc" = "1" ]; then
      # Look for terminator. If `<<-`, leading tabs are stripped.
      local probe="$line"
      if [ "$heredoc_dash" = "1" ]; then
        probe="${line#${line%%[!	]*}}"   # strip leading tabs
      fi
      if [ "$probe" = "$heredoc_marker" ]; then
        in_heredoc=0
        masked+="$line"$'\n'
      else
        masked+="HEREDOC_BODY"$'\n'
      fi
    else
      # Detect heredoc start. Matches `<< [-]? ['"]? WORD ['"]?` and captures
      # the WORD. The marker may be unquoted (`<<EOF`), single-quoted
      # (`<<'EOF'`), or double-quoted (`<<"EOF"`); single-quoted markers
      # additionally disable expansion inside the body but for our masking
      # purposes the quote form is irrelevant — we only need to recognise it.
      # The `<<-` variant strips leading tabs from the terminator line.
      # We do not need to be perfect — false positives just mask
      # more aggressively, which is the safe direction.
      local hd_match
      hd_match=$(printf '%s' "$line" \
        | grep -oE '<<-?[[:space:]]*("[A-Za-z_][A-Za-z0-9_]*"|'"'"'[A-Za-z_][A-Za-z0-9_]*'"'"'|[A-Za-z_][A-Za-z0-9_]*)' \
        | tail -1)
      if [ -n "$hd_match" ]; then
        in_heredoc=1
        # Extract dash flag and marker.
        if printf '%s' "$hd_match" | grep -q '^<<-'; then
          heredoc_dash=1
        else
          heredoc_dash=0
        fi
        # Strip leading `<<-?` and any quote wrappers around the marker word.
        heredoc_marker=$(printf '%s' "$hd_match" \
          | sed -E "s/^<<-?[[:space:]]*//;s/^['\"]//;s/['\"]\$//")
      fi
      masked+="$line"$'\n'
    fi
  done <<< "$cmd"

  # Mask balanced quoted regions and command substitutions iteratively.
  # Single-pass sed with t-jump loops walks until no more replacements apply.
  masked=$(printf '%s' "$masked" | sed -E '
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
  ')

  # Now tokenise on shell metacharacters: whitespace, ;, &, |, (, ), <, >, newline.
  # We emit each token followed by a NUL byte so the caller can use read -d ''.
  printf '%s' "$masked" \
    | tr ';&|()<>\n' ' ' \
    | tr -s ' ' \
    | awk '{for (i=1;i<=NF;i++) printf "%s\0", $i}'
}

# Emit the first command-token of each pipeline segment (segments split on
# `;`, `&&`, `||`, `|`, newline). One token per line. Quote/heredoc masking
# is applied so `echo "git pull" | grep ...` correctly emits `echo` and `grep`
# (not `git`).
gitban_first_command_token() {
  local cmd="$1"

  # Apply the same masking pass as the tokeniser, but preserve segment
  # separators. We mask quoted regions and heredoc bodies; we DO NOT collapse
  # all separators to spaces.
  local masked
  masked=$(printf '%s' "$cmd" | sed -E '
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
  ')

  # Split on segment separators. awk gets RS for `\n;` and we additionally
  # break on `&&`, `||`, `|` via a pre-substitution.
  printf '%s' "$masked" \
    | sed -E 's/(&&|\|\|)/\n/g; s/[|;]/\n/g' \
    | awk '
        {
          # Strip leading whitespace and any VAR=value prefixes (assignments)
          # so the FIRST real command token is what we emit.
          sub(/^[[:space:]]+/, "")
          while (match($0, /^[A-Za-z_][A-Za-z0-9_]*=/) > 0) {
            sub(/^[A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+)[[:space:]]*/, "")
          }
          if (NF >= 1) {
            print $1
          }
        }
      '
}

# Emit the command-string with heredoc bodies, single/double-quoted regions,
# `$(...)` regions, and backtick regions replaced by neutral placeholders.
# Structure (line breaks, segment separators, whitespace) is preserved so the
# caller can run position-aware regex scans against the masked text without
# false positives from prose inside heredoc bodies (the `gnvoxa` failure mode)
# or quoted strings.
#
# This is the right primitive for hooks like `cwd-pin-check.sh` that scan the
# whole command for `git <subcmd>` matches and need to ignore matches inside
# string literals. The NUL-stream emitted by `gitban_tokenize_command` is
# lossy for position-aware logic (e.g. left-walk `cd ... && git ...`); use
# this function when you need the masked text with structure intact.
gitban_mask_command_text() {
  local cmd="$1"

  # Phase 1 — heredoc-body masking via a single in-process awk pass.
  # An earlier implementation used a bash per-line loop that called grep/sed
  # subprocesses for every line; on multi-line scaffold SKILL blocks this
  # pushed the masking step to 1.5+ seconds per hook invocation, which then
  # accumulated to 30s timeouts in the corpus-mutation pytest suite. The awk
  # implementation performs the same state-machine work in one process for
  # millisecond-scale runtime.
  #
  # Heredoc syntax recognised:
  #   <<WORD   <<-WORD   <<'WORD'   <<-'WORD'   <<"WORD"   <<-"WORD"
  # The trailing ``-`` form strips leading tabs from the terminator line.
  # Marker word is ``[A-Za-z_][A-Za-z0-9_]*``. Marker quotes are stripped
  # before terminator comparison. The opener must be followed by whitespace,
  # `;`, `|`, `&`, `)`, or end-of-line to count (rejects false positives
  # like a literal `<<EOFsomething`).
  local masked
  masked=$(printf '%s' "$cmd" | awk '
    BEGIN { in_hd = 0; marker = ""; dash = 0 }
    {
      if (in_hd) {
        probe = $0
        if (dash) { sub(/^\t+/, "", probe) }
        if (probe == marker) {
          in_hd = 0
          print $0
        } else {
          print "HEREDOC_BODY"
        }
        next
      }
      line = $0
      L = length(line)
      last_idx = 0
      last_marker = ""
      last_dash = 0
      last_open_q = 0
      last_close_q = 0
      i = 1
      while (i <= L - 1) {
        if (substr(line, i, 2) == "<<") {
          j = i + 2
          this_dash = 0
          if (substr(line, j, 1) == "-") { this_dash = 1; j++ }
          while (j <= L && (substr(line, j, 1) == " " || substr(line, j, 1) == "\t")) { j++ }
          qch = ""
          open_q = 0
          close_q = 0
          if (j <= L) {
            c1 = substr(line, j, 1)
            if (c1 == "\"" || c1 == "'\''") { qch = c1; open_q = j; j++ }
          }
          start = j
          while (j <= L) {
            ch = substr(line, j, 1)
            if (ch ~ /[A-Za-z0-9_]/) { j++ } else { break }
          }
          if (j > start) {
            mname = substr(line, start, j - start)
            if (qch != "" && substr(line, j, 1) == qch) { close_q = j; j++ }
            tail_ch = substr(line, j, 1)
            if (j > L || tail_ch ~ /[[:space:];|&)]/ || tail_ch == "") {
              last_idx = i
              last_marker = mname
              last_dash = this_dash
              last_open_q = open_q
              last_close_q = close_q
            }
          }
          i = j
        } else {
          i++
        }
      }
      if (last_idx > 0) {
        in_hd = 1
        marker = last_marker
        dash = last_dash
        # B1 fix: neutralise the quote characters around the heredoc marker on
        # the opener line so Phase 2 sed cannot pair them with quotes in any
        # outer context (e.g., `gh pr create --body "$(cat <<"EOF"`). Replacing
        # them with an underscore preserves line length / positions for the
        # downstream cd-pin left-walk scan. Only neutralises double-quotes;
        # single-quoted markers are masked away by Phase 2 as QUOTEDARG which
        # is already correct.
        if (last_close_q > 0 && substr(line, last_open_q, 1) == "\"") {
          line = substr(line, 1, last_open_q - 1) "_" substr(line, last_open_q + 1, last_close_q - last_open_q - 1) "_" substr(line, last_close_q + 1)
        }
      }
      print line
    }
  ')

  # Phase 2 — mask balanced quoted regions and command substitutions in
  # the same awk-output stream by post-processing with sed. We could fold
  # this into the heredoc awk pass for one fewer subprocess, but the sed
  # t-jump loops are concise and the marginal speedup isn't worth the awk
  # logic-density. The two-process pipeline still runs ~10x faster than
  # the previous bash-loop implementation.
  #
  # Multi-line quoted-region handling (2026-05-28): default sed reads
  # one line per cycle, so a `"...multi-line...string..."` (real bash
  # syntax) is never matched and its body leaks through unmaskered. The
  # validate-no-direct path-extractor then catches `.gitban/...` literals
  # embedded in commit-message prose, producing a false-positive block.
  # Fix: use `sed -z` (whole-input record) when GNU sed is detected so
  # `[^"]*` can match across newlines. BSD sed (macOS default) lacks
  # `-z` and stays on the line-bound path — the punctuation-strip in
  # validate-no-direct is the defense-in-depth for that environment.
  # Detection is cached at library-source time (one feature-probe per
  # process, no per-invocation overhead).
  if [ -z "${_GITBAN_SED_Z_SUPPORTED:-}" ]; then
    if printf '' | sed -z '' >/dev/null 2>&1; then
      _GITBAN_SED_Z_SUPPORTED=1
    else
      _GITBAN_SED_Z_SUPPORTED=0
    fi
  fi
  if [ "$_GITBAN_SED_Z_SUPPORTED" = "1" ]; then
    printf '%s' "$masked" | sed -zE '
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
    '
  else
    printf '%s' "$masked" | sed -E '
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
    '
  fi
}

# Normalise a filesystem path: backslashes → forward slashes; collapse
# repeated separators; strip trailing slash (except for root). The
# classification regexes are written to match either separator, but
# normalising up front means the audit log has stable, comparable strings.
#
# Pure-bash implementation — no subprocess forks. On Git Bash MSYS each fork
# costs ~300-500ms (sometimes >1s under contention from parallel agents);
# the previous `printf | sed` pipe cost ~0.8s/call. This implementation runs
# in <20ms by using parameter expansion only. The slash-collapse loop is
# bounded by path length so a pathological "/////" input cannot spin.
# SCAFREL1:7A1 (whu6i3).
gitban_normalize_path() {
  local path="$1"
  # Convert backslashes (single and double) to forward slashes.
  path="${path//\\\\//}"
  path="${path//\\//}"
  # Collapse multiple slashes — pure bash, no fork. Each pass halves
  # consecutive-slash runs; for any sane filesystem path one or two
  # passes terminate.
  while [ "${path/\/\//}" != "$path" ]; do
    path="${path//\/\//\/}"
  done
  # Strip trailing slash (unless the whole path is "/").
  if [ ${#path} -gt 1 ]; then
    path="${path%/}"
  fi
  printf '%s' "$path"
}

# Classify a path. Emits "hard", "soft", or "unprotected".
#
# Pure-bash regex match via the `[[ =~ ]]` operator — no `printf | grep`
# fork. The classification regexes (`GITBAN_HARD_RE`, `GITBAN_SOFT_RE`)
# are POSIX-ERE compatible with bash's regex engine; the original
# `grep -qiE` form was case-insensitive but the path family the
# classifier accepts (`.gitban/cards/`, `.gitban/roadmap/`, etc.) is
# entirely lowercase ASCII in practice so case-folding is unnecessary.
# If a case-insensitive match is later required, lowercase the input
# with `${path,,}` (pure bash) before the comparison rather than
# re-introducing the fork.
# SCAFREL1:7A1 (whu6i3) — pre-fix cost was ~0.74s/call on Git Bash MSYS.
gitban_classify_protected_path() {
  local path="$1"
  if [[ "$path" =~ $GITBAN_HARD_RE ]]; then
    echo "hard"
  elif [[ "$path" =~ $GITBAN_SOFT_RE ]]; then
    echo "soft"
  else
    echo "unprotected"
  fi
}

# Classify a git subcommand. Emits "read", "meta", or "write".
#
# Pure-bash regex match (no `printf | grep` fork). See
# `gitban_classify_protected_path` for the same fork-elimination
# rationale. SCAFREL1:7A1 (whu6i3).
gitban_classify_git_subcommand() {
  local subcmd="$1"
  if [[ "$subcmd" =~ $GITBAN_READ_CLASS_RE ]]; then
    echo "read"
  elif [[ "$subcmd" =~ $GITBAN_META_CLASS_RE ]]; then
    echo "meta"
  else
    echo "write"
  fi
}

# Classify a Claude Code tool name by *dispatch branch* — the shape of its
# tool_input payload as far as the validate-* PreToolUse hooks are concerned.
# Single source of truth for "which branch does this hook take?" across the
# whole hook family (ADR-054 §Decision 1 + SCAFREL1/45r1u4 review).
#
# Returns exactly one of:
#   file_path  — payload carries tool_input.file_path; classify by path.
#                Tools: Write, Edit, NotebookEdit.
#   command    — payload carries tool_input.command; classify by command text.
#                Tools: Bash, PowerShell. PowerShell is intentionally HERE and
#                NOT in file_path: the PowerShell tool payload is a command
#                string, not a file_path. Routing it through file_path is the
#                xosv96 B1 defect surface — gitban_decode_file_path returns
#                empty for PowerShell and the hook silently passes (`o3z0mx`
#                regression). The shared classifier is the structural fix:
#                future hooks inherit this decision automatically instead of
#                each re-discovering the PowerShell-routes-as-command rule.
#   discovery  — read-only / discovery tools that never need protection.
#                Tools: Read, Grep, Glob, ToolSearch.
#
# Unknown tool names default to `discovery` (conservative-allow). MCP tool
# names (`mcp__*`) also default to `discovery` — MCP server tools mutate
# gitban state through the validated MCP code path, not by writing to disk
# directly, so they never need PreToolUse protection.
gitban_classify_tool_dispatch() {
  local tool_name="$1"
  case "$tool_name" in
    Write|Edit|NotebookEdit)
      echo "file_path"
      ;;
    Bash|PowerShell)
      echo "command"
      ;;
    Read|Grep|Glob|ToolSearch)
      echo "discovery"
      ;;
    mcp__*)
      echo "discovery"
      ;;
    *)
      # Conservative default: unknown tools cannot be classified, so treat
      # them as discovery (silently pass). Better to under-block than to
      # over-block legitimate new tools.
      echo "discovery"
      ;;
  esac
}

# Check for an unconsumed bypass sentinel for the given hook + target.
#
# Args: $1 = hook_name, $2 = path_or_fingerprint.
#
# Scans `.gitban/audit/bypasses/*.json` for a sentinel whose JSON body
# matches (`"hook": "$1"`, `"target": "$2"`) AND is within its TTL window.
# On hit, attempts atomic-rename to `.consumed-<ts_ns>.json` — exactly one
# of N concurrent hooks wins the rename; the loser sees the source missing
# and continues scanning (or returns 1, falling back to block).
#
# Returns 0 (allow) on successful consume; 1 (block) otherwise. The post-
# success caller is expected to call `gitban_audit_consumed_append` with
# the consumed-sentinel basename to record the bypass.
#
# Design (ADR-054 §"MCP sentinel write-and-consume protocol"):
#   - JSON parsing uses grep+sed (jq-free). The sentinel format is
#     written by the MCP tool with stable key order so the simple
#     regex matchers are sufficient. If jq is on PATH it is preferred
#     (more robust on exotic inputs).
#   - TTL is checked against `created_iso` + `ttl_seconds`. If `date -d`
#     is unavailable (BSD/macOS without coreutils), the function falls
#     back to extracting the ts_ns embedded in the sentinel filename.
#   - The atomic rename IS the lock — POSIX rename is atomic; NTFS
#     rename is rename-or-fail. No flock needed for race resolution.
gitban_check_bypass_sentinel() {
  local hook="$1" target="$2"
  local workspace="${GITBAN_WORKSPACE:-}"
  if [ -z "$workspace" ]; then
    # Walk up from cwd looking for .gitban/.
    local d="$PWD"
    while [ "$d" != "/" ] && [ -n "$d" ]; do
      if [ -d "$d/.gitban" ]; then
        workspace="$d"
        break
      fi
      d=$(dirname "$d")
    done
    [ -z "$workspace" ] && workspace="$PWD"
  fi
  local bypasses_dir="$workspace/.gitban/audit/bypasses"
  [ -d "$bypasses_dir" ] || return 1

  local now_s
  now_s=$(date +%s 2>/dev/null) || return 1

  # Read each *.json sentinel (skip *.consumed-*.json and *.tmp).
  local sentinel
  for sentinel in "$bypasses_dir"/*.json; do
    [ -f "$sentinel" ] || continue
    case "$sentinel" in
      *.consumed-*.json) continue ;;
      *.json.tmp)        continue ;;
    esac

    # Read body once.
    local body
    body=$(cat "$sentinel" 2>/dev/null) || continue
    [ -n "$body" ] || continue

    # Extract sentinel hook + target. jq if available, else grep+sed.
    local sentinel_hook sentinel_target
    if command -v jq >/dev/null 2>&1; then
      sentinel_hook=$(printf '%s' "$body" | jq -r '.hook // empty' 2>/dev/null)
      sentinel_target=$(printf '%s' "$body" | jq -r '.target // empty' 2>/dev/null)
    else
      sentinel_hook=$(printf '%s' "$body" \
        | grep -oE '"hook"[[:space:]]*:[[:space:]]*"[^"]*"' \
        | head -1 | sed 's/.*: *"//;s/"$//')
      sentinel_target=$(printf '%s' "$body" \
        | grep -oE '"target"[[:space:]]*:[[:space:]]*"[^"]*"' \
        | head -1 | sed 's/.*: *"//;s/"$//')
    fi
    [ "$sentinel_hook" = "$hook" ] || continue
    [ "$sentinel_target" = "$target" ] || continue

    # TTL gate. Extract created_iso + ttl_seconds; fall back to filename
    # ts_ns if `date -d` can't parse ISO-8601 (BSD/macOS plain `date`).
    local ttl_s
    if command -v jq >/dev/null 2>&1; then
      ttl_s=$(printf '%s' "$body" | jq -r '.ttl_seconds // 300' 2>/dev/null)
    else
      ttl_s=$(printf '%s' "$body" \
        | grep -oE '"ttl_seconds"[[:space:]]*:[[:space:]]*[0-9]+' \
        | head -1 | sed 's/.*: *//')
    fi
    [ -n "$ttl_s" ] || ttl_s=300

    local created_s=""
    local created_iso
    if command -v jq >/dev/null 2>&1; then
      created_iso=$(printf '%s' "$body" | jq -r '.created_iso // empty' 2>/dev/null)
    else
      created_iso=$(printf '%s' "$body" \
        | grep -oE '"created_iso"[[:space:]]*:[[:space:]]*"[^"]*"' \
        | head -1 | sed 's/.*: *"//;s/"$//')
    fi
    if [ -n "$created_iso" ]; then
      created_s=$(date -d "$created_iso" +%s 2>/dev/null) \
        || created_s=$(date -j -f '%Y-%m-%dT%H:%M:%S%z' "${created_iso%.[0-9]*+*}" +%s 2>/dev/null) \
        || created_s=""
    fi
    if [ -z "$created_s" ]; then
      # Fall back to filename ts_ns. Pattern: <sha>-<ts_ns>-<pid>.json
      local base ts_ns
      base=$(basename "$sentinel" .json)
      ts_ns=$(printf '%s' "$base" | awk -F'-' '{print $(NF-1)}')
      if [ -n "$ts_ns" ] && [ "${ts_ns}" -eq "${ts_ns}" ] 2>/dev/null; then
        # ts_ns is nanoseconds since epoch; reduce to seconds.
        created_s=$(( ts_ns / 1000000000 ))
      fi
    fi
    [ -n "$created_s" ] || continue

    local age=$(( now_s - created_s ))
    if [ "$age" -gt "$ttl_s" ]; then
      # Expired; let GC handle. Don't consume.
      continue
    fi

    # Atomic consume: rename to .consumed-<ts_ns>.json. The losing racer
    # sees the source missing; mv fails non-zero; we continue scanning.
    local consume_ts
    consume_ts=$(date +%s%N 2>/dev/null) || consume_ts="$now_s"
    local consumed="${sentinel%.json}.consumed-${consume_ts}.json"
    if mv "$sentinel" "$consumed" 2>/dev/null; then
      # We won. Emit the consumed-basename on stdout for the hook's
      # audit row (used if the hook wants to record sentinel_id).
      printf '%s' "$(basename "$consumed")"
      return 0
    fi
    # Lost race; try next sentinel.
  done

  return 1
}

# Append one JSONL row to the named audit file with concurrency protection.
#
# Low-level entry point: callers compose the JSON row and pass it in. The
# library handles atomicity (flock or per-pid fallback), 3500-byte truncation,
# and 100MiB rotation. Failures never propagate to the caller (audit is
# observational; a write failure must not turn into a hook block).
#
# For the canonical hook-invocation schema, prefer
# `gitban_audit_invocation_append` — it composes the row from named fields.
gitban_audit_append() {
  local file="$1"
  local row="$2"
  [ -z "$file" ] && return 0
  [ -z "$row" ] && return 0
  _gitban_atomic_append "$file" "$row"
}

# Append a canonical hook-invocation row to
# `.gitban/audit/hook_invocations.jsonl`.
#
# Schema (ADR-054 §"Hook invocation audit log"):
#   {
#     "ts":                   ISO-8601 UTC,
#     "hook":                 hook script name,
#     "tool":                 tool_name from the payload (Write/Edit/Bash/...),
#     "classification":       one of block|pass|bypass|advisory|error,
#     "target":               path-or-fingerprint the hook keyed on,
#     "bypass_sentinel_id":   filename of consumed sentinel (if classification=bypass),
#     "exit_code":            exit code about to be emitted by the hook,
#     "handle":               operator handle
#   }
#
# Args (positional, all required except $5/$6 which may be empty):
#   $1 hook_name           e.g. "validate-no-direct-card-edit"
#   $2 tool_name           e.g. "Write"
#   $3 classification      block|pass|bypass|advisory|error
#   $4 target              path-or-fingerprint
#   $5 bypass_sentinel_id  optional; "" when classification != bypass
#   $6 exit_code           integer; "" implies 0
#
# This is the recommended call shape for hooks. The hook decides
# classification immediately before its `exit` call and writes the row in the
# same shell, so even crashed/killed hooks leave a record of intent if they
# reach the call point.
#
# Consume-pairing pattern (5ydhvn L1 fold):
#   sentinel_id=$(gitban_check_bypass_sentinel "$hook" "$target") && {
#     gitban_audit_consumed_append "$sentinel_id" "$hook" "$target"
#     gitban_audit_invocation_append "$hook" "$tool" "bypass" "$target" "$sentinel_id" 0
#     exit 0
#   }
gitban_audit_invocation_append() {
  local hook_name="$1"
  local tool_name="$2"
  local classification="$3"
  local target="$4"
  local sentinel_id="${5:-}"
  local exit_code="${6:-0}"

  local row
  row=$(printf '{"ts":"%s","hook":"%s","tool":"%s","classification":"%s","target":"%s","bypass_sentinel_id":"%s","exit_code":%s,"handle":"%s"}' \
    "$(_gitban_json_escape "$(_gitban_timestamp)")" \
    "$(_gitban_json_escape "$hook_name")" \
    "$(_gitban_json_escape "$tool_name")" \
    "$(_gitban_json_escape "$classification")" \
    "$(_gitban_json_escape "$target")" \
    "$(_gitban_json_escape "$sentinel_id")" \
    "${exit_code:-0}" \
    "$(_gitban_json_escape "$(_gitban_handle)")")

  local workspace="${GITBAN_WORKSPACE:-}"
  local audit_path
  if [ -n "$workspace" ]; then
    audit_path="$workspace/.gitban/audit/hook_invocations.jsonl"
  else
    audit_path=".gitban/audit/hook_invocations.jsonl"
  fi
  _gitban_atomic_append "$audit_path" "$row"
}

# Append a sentinel-consumed audit row.
#
# Called by the hook that wins the sentinel-consume rename race, immediately
# before exiting 0. The companion call to `gitban_audit_invocation_append`
# with classification=bypass records the bypass in the canonical
# hook-invocations log as well; the consumed log is the focused per-sentinel
# trail.
gitban_audit_consumed_append() {
  local sentinel_id="$1"
  local hook_name="$2"
  local path_or_fp="$3"
  local row
  row=$(printf '{"timestamp":"%s","sentinel_id":"%s","hook_name":"%s","target":"%s","handle":"%s"}' \
    "$(_gitban_json_escape "$(_gitban_timestamp)")" \
    "$(_gitban_json_escape "$sentinel_id")" \
    "$(_gitban_json_escape "$hook_name")" \
    "$(_gitban_json_escape "$path_or_fp")" \
    "$(_gitban_json_escape "$(_gitban_handle)")")
  local workspace="${GITBAN_WORKSPACE:-}"
  local audit_path
  if [ -n "$workspace" ]; then
    audit_path="$workspace/.gitban/audit/bypasses_consumed.jsonl"
  else
    audit_path=".gitban/audit/bypasses_consumed.jsonl"
  fi
  _gitban_atomic_append "$audit_path" "$row"
}

# Emit a canonical block message to stderr and exit 2. The hook caller
# decides whether to call this — the library just formats consistently.
# Usage: gitban_emit_block REASON PATH MCP_SUGGESTION
gitban_emit_block() {
  local reason="$1"
  local path="$2"
  local mcp_suggestion="${3:-}"
  echo "BLOCKED: $reason" >&2
  if [ -n "$path" ]; then
    echo "  Path: $path" >&2
  fi
  if [ -n "$mcp_suggestion" ]; then
    echo "  Use $mcp_suggestion instead." >&2
  fi
  echo "  To allow a one-off legitimate edit, call the corresponding" >&2
  echo "  mcp__gitban__allow_*_once tool before retrying. (See ADR-054.)" >&2
  exit 2
}

# Emit a stderr advisory (no exit). Soft-protected path warning.
gitban_emit_advisory() {
  local reason="$1"
  local path="$2"
  echo "NOTE: $reason" >&2
  if [ -n "$path" ]; then
    echo "  Path: $path" >&2
  fi
}

# Emit a one-shot DEPRECATED stderr warning for any legacy env-var bypass
# that the operator has set in the environment. ADR-054 supersedes the
# env-var family with the `mcp__gitban__allow_hook_bypass_once` MCP tool;
# the env-vars are still *read* during the v0.X+1 deprecation window so
# the operator gets a loud signal that their workflow needs migration.
#
# Silent removal would just produce silent block-failures — the next
# hook invocation that the env-var would have bypassed now rejects with
# no clue why the previously-working escape stopped working. The warning
# names the deprecated variable, the canonical MCP-tool replacement, and
# the ADR.
#
# Idempotent: a single hook invocation may source the library once and
# decode multiple branches; the warning fires only once per environment
# variable per hook process via a `_GITBAN_DEPRECATED_<VAR>_EMITTED` sentinel
# (one variable per sentinel so multiple deprecated vars set together each
# get their own line).
#
# Called automatically at library-load time; no explicit invocation needed.
gitban_emit_env_deprecation() {
  local var msg replacement
  for var in GITBAN_ALLOW_DIRECT_EDIT GITBAN_ALLOW_CWD_PIN_BYPASS GITBAN_CWD_PIN_HOOK_MODE GITBAN_ALLOW_WORKTREE_BYPASS; do
    # Skip unset variables (the empty-string default keeps `set -u` safe).
    local val
    eval "val=\"\${$var:-}\""
    [ -n "$val" ] || continue

    # Per-process idempotency: emit at most once per (process, var).
    local sentinel="_GITBAN_DEPRECATED_${var}_EMITTED"
    eval "local already=\"\${$sentinel:-}\""
    [ -z "$already" ] || continue
    eval "$sentinel=1"

    case "$var" in
      GITBAN_ALLOW_DIRECT_EDIT)
        replacement='mcp__gitban__allow_hook_bypass_once(hook_name="validate-no-direct-gitban-state-edit", target=..., reason=...)'
        ;;
      GITBAN_ALLOW_CWD_PIN_BYPASS)
        replacement='mcp__gitban__allow_hook_bypass_once(hook_name="cwd-pin-check", target=..., reason=...)'
        ;;
      GITBAN_CWD_PIN_HOOK_MODE)
        replacement='mcp__gitban__allow_hook_bypass_once(hook_name="cwd-pin-check", target=..., reason=...)'
        ;;
      GITBAN_ALLOW_WORKTREE_BYPASS)
        replacement='mcp__gitban__allow_hook_bypass_once(hook_name=..., target=..., reason=...)'
        ;;
      *)
        replacement='mcp__gitban__allow_hook_bypass_once(hook_name=..., target=..., reason=...)'
        ;;
    esac

    msg="DEPRECATED: env-var bypass $var is no longer honoured. Use $replacement instead."
    echo "$msg" >&2
    echo "  See ADR-054 §Decision 3 for the migration rationale." >&2
  done
}

# Fire the deprecation emit automatically on library load. This places the
# warning at the start of every hook invocation that sources the library,
# which is the right time — before the hook makes any decision the operator
# might have expected the env-var to influence. Disable via
# GITBAN_HOOK_INPUT_SUPPRESS_DEPRECATION=1 for self-test contexts that
# intentionally set the env-vars to exercise legacy code paths.
if [ -z "${GITBAN_HOOK_INPUT_SUPPRESS_DEPRECATION:-}" ]; then
  gitban_emit_env_deprecation
fi

# ---------------------------------------------------------------------------
# Hook-invocation audit auto-wiring (SCAFREL1/bgv98b)
# ---------------------------------------------------------------------------
# `gitban_audit_init HOOK_NAME TOOL_NAME` registers an EXIT trap that emits
# exactly one canonical hook-invocation row when the hook process terminates
# — regardless of which `exit` statement is taken, including the implicit
# `exit 2` inside `gitban_emit_block` and any early-return read/discovery
# branch. The hook updates classification state through helpers below; the
# trap reads the final state and the propagated `$?` for the exit_code.
#
# Design: every hook in scope must call `gitban_audit_init` immediately
# after sourcing this library. Pre-existing hooks already have many `exit`
# points; routing every path through a manually-placed audit call is a
# maintenance liability (the drift-guard test in
# tests/hooks/test_audit_invocation_wiring.py exists because we've already
# shipped one hook that forgot the wiring). A trap is the structural
# solution.
#
# State variables (all `_GITBAN_AUDIT_*` are owned by this subsystem):
#   _GITBAN_AUDIT_INIT          1 if init ran (suppresses double-emit).
#   _GITBAN_AUDIT_HOOK          hook name passed to init.
#   _GITBAN_AUDIT_TOOL          tool name passed to init (mutable via _set_tool).
#   _GITBAN_AUDIT_CLASS         classification (default "pass"; updated to
#                               "block"/"bypass"/"advisory"/"error" by helpers).
#   _GITBAN_AUDIT_TARGET        path-or-fingerprint (default "").
#   _GITBAN_AUDIT_SENTINEL_ID   sentinel filename (set on bypass).
#   _GITBAN_AUDIT_FIRED         1 after the trap has emitted (idempotent).

# Initialise the audit auto-wiring. Call once per hook, right after sourcing
# the library. Safe to call again — second call is a no-op.
gitban_audit_init() {
  if [ "${_GITBAN_AUDIT_INIT:-0}" = "1" ]; then
    return 0
  fi
  _GITBAN_AUDIT_INIT=1
  _GITBAN_AUDIT_HOOK="${1:-unknown-hook}"
  _GITBAN_AUDIT_TOOL="${2:-}"
  _GITBAN_AUDIT_CLASS="pass"
  _GITBAN_AUDIT_TARGET=""
  _GITBAN_AUDIT_SENTINEL_ID=""
  _GITBAN_AUDIT_FIRED=0
  # shellcheck disable=SC2064
  trap "_gitban_audit_trap_emit \$?" EXIT
}

# Update the tool_name after init (hooks decode the payload AFTER calling
# init, so init's tool argument is usually the empty string and this setter
# fills it in once the decode lands).
gitban_audit_set_tool() {
  _GITBAN_AUDIT_TOOL="${1:-$_GITBAN_AUDIT_TOOL}"
}

# Update the target (path or fingerprint the hook keyed on). Idempotent.
gitban_audit_set_target() {
  _GITBAN_AUDIT_TARGET="${1:-$_GITBAN_AUDIT_TARGET}"
}

# Mark the invocation as a block. Hooks call this immediately before invoking
# `gitban_emit_block` (or any other path that exits non-zero with intent).
gitban_audit_mark_block() {
  _GITBAN_AUDIT_CLASS="block"
  if [ -n "${1:-}" ]; then
    _GITBAN_AUDIT_TARGET="$1"
  fi
}

# Mark the invocation as a bypass. Hooks call this when they consume a
# bypass sentinel or accept a legacy env-var override.
gitban_audit_mark_bypass() {
  _GITBAN_AUDIT_CLASS="bypass"
  if [ -n "${1:-}" ]; then
    _GITBAN_AUDIT_SENTINEL_ID="$1"
  fi
  if [ -n "${2:-}" ]; then
    _GITBAN_AUDIT_TARGET="$2"
  fi
}

# Mark the invocation as an advisory (soft-protected warn, advisory-mode
# allow). Distinct from "pass" because it indicates the hook had something
# to say even though it exited 0.
gitban_audit_mark_advisory() {
  _GITBAN_AUDIT_CLASS="advisory"
  if [ -n "${1:-}" ]; then
    _GITBAN_AUDIT_TARGET="$1"
  fi
}

# Internal trap handler. Emits the canonical row once with the propagated
# exit code, then re-exits with the same code so the trap is transparent.
_gitban_audit_trap_emit() {
  local rc="${1:-0}"
  if [ "${_GITBAN_AUDIT_FIRED:-0}" = "1" ]; then
    return 0
  fi
  _GITBAN_AUDIT_FIRED=1
  # If the hook never updated the classification but exited non-zero, treat
  # the exit as an error (something killed the script before it reached a
  # classification decision). Exit 0 with default state = pass.
  local cls="${_GITBAN_AUDIT_CLASS:-pass}"
  if [ "$cls" = "pass" ] && [ "$rc" != "0" ]; then
    cls="error"
  fi
  gitban_audit_invocation_append \
    "${_GITBAN_AUDIT_HOOK:-unknown-hook}" \
    "${_GITBAN_AUDIT_TOOL:-}" \
    "$cls" \
    "${_GITBAN_AUDIT_TARGET:-}" \
    "${_GITBAN_AUDIT_SENTINEL_ID:-}" \
    "$rc"
}
