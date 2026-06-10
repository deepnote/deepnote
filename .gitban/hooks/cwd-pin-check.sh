#!/bin/bash
# CWD-pin enforcement hook (ADR-051) -- PreToolUse:Bash.
#
# Scans every proposed Bash command for occurrences of `git <subcommand>`
# using a single whole-command regex against the *masked* command text
# (heredoc bodies, single/double-quoted regions, $(...) and backticks are
# replaced with neutral placeholders before scanning — closes `gnvoxa`).
# For each match:
#   1. Classify the subcommand. Read-class and meta-class -> allow.
#   2. `git tag <name>` with no explicit commit argument -> reject as bare-tag
#      regardless of `-C` pinning. Per ADR-051, the `-C "$PARENT"` pin pins
#      the ref namespace (which `.git/refs/tags/<name>` the tag lands in),
#      not the target commit (what HEAD resolves to from `-C`'s CWD). The
#      explicit-commit form `git -C "$PARENT" tag <name> "$(git rev-parse HEAD)"`
#      is required.
#   3. Write-class with an immediately-following `-C "..."` token sequence
#      (captured by the regex) -> allow.
#   4. Write-class with a same-segment `cd "..." &&` that precedes the match
#      (left-walk fallback) -> allow.
#   5. Otherwise -> reject with exit 2 and a teaching stderr message.
#
# Read-class git is allowed unpinned because its failure mode under CWD
# drift is wrong-data-return (loud), not silent-wrong-target (silent). The
# corresponding SKILL prose still pins read-class for audit-log fidelity
# and feed-forward read-into-write protection -- this hook does not enforce
# that part.
#
# **Stash family (ADR-053 corrigendum, folded into SCAFREL1 step 4 per ADR-053
# design doc blocker 1):** every `git stash <subaction>` (pop, apply, drop,
# show, list, push, save, branch, create, store) is allowed bare-in-worktree.
# The library's `GITBAN_READ_CLASS_RE` (single source of truth) is the carrier
# for the reclassification — this hook reads from the library, no local
# duplication.
#
# **PowerShell tool payloads (ADR-054 §Decision 1, step 4 strategy):** this
# hook only inspects `Bash` payloads. `PowerShell` tool calls cannot be
# meaningfully tokenised by bash rules (semicolon-chains, here-strings
# `@'...'@`, call-operator `& "C:\path\app.exe"`) and the bash tokeniser
# would mis-classify them. The PowerShell-routed-write surface is closed at
# a higher layer:
#   * `validate-no-direct-gitban-state-edit.sh` enforces ADR-045 on PowerShell
#     `Set-Content`/`Out-File`/`New-Item` payloads via the library's
#     `gitban_decode_file_path` (path-based, not command-syntax-based).
#   * For PowerShell-routed `git` calls themselves, operators use the canonical
#     `git -C "$PARENT" <subcmd>` form per CLAUDE.md; if a PowerShell git
#     hook is ever needed, it would ship as a sibling with a PowerShell-aware
#     tokeniser, not as a bash-tokeniser bolt-on here.
# The test suite documents this with a PowerShell git fixture asserting the
# hook returns exit 0 (out-of-scope) regardless of pin status.
#
# Environment-variable contract:
#   GITBAN_CWD_PIN_HOOK_MODE
#     `enforce` (default; rejects unpinned write-class)
#     `advisory` (logs to .gitban/audit/cwd_pin_advisory.jsonl, exits 0)
#     any other value is treated as `enforce`.
#   GITBAN_ALLOW_CWD_PIN_BYPASS=1
#     allows a single invocation. Writes a JSONL entry to
#     .gitban/audit/cwd_pin_bypasses.jsonl and emits a stderr advisory.
#     ADR-054 supersedes the env-var form with the
#     `mcp__gitban__allow_hook_bypass_once(hook_name="cwd-pin-check", ...)`
#     MCP tool — both paths are accepted during the migration cycle.
#
# v1 deliberate non-coverage:
#   - PowerShell tool payloads (covered above — out of scope, separate hook
#     surface if ever needed).
#   - Multi-line continuations (`\` at line end). The hook reads the whole
#     command string verbatim; line continuations resolve naturally.
#
# After the step-4 refactor (sources gitban-hook-input.sh):
#   - Heredoc bodies (`<<EOF ... git merge ... EOF`, `<<'EOF' ...`, `<<"EOF" ...`)
#     are masked to `HEREDOC_BODY` before the regex scan — false positive
#     closed (`gnvoxa`).
#   - Single- and double-quoted strings containing the literal `git` are
#     masked to `QUOTEDARG` — false positive closed.
#   - Backtick command substitution and `$(...)` are masked to `CMDSUB`.
#
# Portability: bash + grep + sed + awk only (no jq), MSYS2/Git Bash
# compatible. The shared library handles cross-platform decoding
# (jq → python3 → python → sed fallback chain).

# Source the canonical input-parsing library (ADR-054 §Decision 1).
# The library is shipped alongside this hook under hooks/lib/.
LIB_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)/lib"
if [ -z "$LIB_DIR" ] || [ ! -f "$LIB_DIR/gitban-hook-input.sh" ]; then
  # Library missing — degrade-open. The hook is enforcement; missing the
  # library means we cannot reliably classify, so we MUST NOT block (would
  # fail-closed against legitimate ops). The settings merger guarantees the
  # library ships with the hook, so this branch is defensive only.
  echo "cwd-pin-check: WARNING — gitban-hook-input.sh library not found; degrading to allow-all." >&2
  exit 0
fi
# shellcheck source=lib/gitban-hook-input.sh
. "$LIB_DIR/gitban-hook-input.sh"

# Wire up hook-invocation audit. The EXIT trap installed here emits exactly
# one row to .gitban/audit/hook_invocations.jsonl per invocation, regardless
# of which exit path the hook takes (SCAFREL1/bgv98b).
gitban_audit_init "cwd-pin-check" "Bash"

INPUT=$(cat)

# ---------------------------------------------------------------------------
# Tool-name + command extraction — inline sed for performance
# ---------------------------------------------------------------------------
# The library's gitban_decode_tool_name/gitban_decode_command helpers go
# through a jq → python3 → python → sed fallback chain. On Git Bash
# without jq (the common scaffolded developer environment), that means
# every hook invocation spawns python (600+ms) twice. For a hot-path
# PreToolUse hook this compounds — the corpus-mutation pytest hits
# 30-second timeouts when each subprocess call carries that latency. We
# inline the sed extraction here (the SAME regex the library's sed
# fallback uses) so the hook runs in well under a second.
#
# The library STILL owns the classification regexes (GITBAN_READ_CLASS_RE,
# GITBAN_META_CLASS_RE) and the masking helper (gitban_mask_command_text);
# only the per-field JSON decode is inlined for performance.

# Bash-native tool_name extraction (no subprocess). The `"tool_name":"X"`
# field is a tiny prefix-region of every payload; bash parameter expansion
# finds it in O(input length) with zero forks. Saves ~4 subshell spawns
# (~200-800ms on Git Bash MSYS) on the warm-path no-op exit. Closes B2
# (SCAFREL1/6au3oc review 1) warm-path latency claim.
TOOL_NAME=""
_after_tn="${INPUT#*\"tool_name\"}"
if [ "$_after_tn" != "$INPUT" ]; then
  # Strip up to the opening quote of the value.
  _after_tn="${_after_tn#*:}"
  _after_tn="${_after_tn#"${_after_tn%%[!  ]*}"}"  # trim leading whitespace
  _after_tn="${_after_tn#\"}"
  # Take up to (but not including) the next unescaped quote. Tool names are
  # bare identifiers in practice (`Bash`, `Edit`, `Write`, `PowerShell`, ...)
  # so backslash-escapes are not a concern here.
  TOOL_NAME="${_after_tn%%\"*}"
fi

# Out-of-scope tools: dispatch via the shared classifier (ADR-054 §Decision 1
# + SCAFREL1/45r1u4 AC #7). The library owns the tool-name -> dispatch-branch
# table so this hook and the validate-* siblings inherit the same decision
# automatically. `file_path` tools (Write/Edit/NotebookEdit) cannot carry a
# git invocation, and `discovery` tools (Read/Grep/Glob/ToolSearch/mcp__*)
# never need protection — both early-exit. Only `command` dispatch (Bash,
# PowerShell) reaches the scan logic below, and PowerShell is then filtered
# out explicitly (see header comment for PowerShell strategy rationale).
DISPATCH=$(gitban_classify_tool_dispatch "$TOOL_NAME")
if [ "$DISPATCH" != "command" ]; then
  exit 0
fi
# PowerShell payloads route to `command` but are still out of scope for this
# bash-tokeniser hook — see the header "PowerShell tool payloads" section.
if [ "$TOOL_NAME" != "Bash" ]; then
  exit 0
fi

# Decode the Bash command field. Escape-aware regex first (matches `\"`
# inside the command), then a simple fallback for unescaped strings. Unlike
# tool_name, the command can contain `\"` (escaped quotes) and span multiple
# lines, so the escape-aware regex is needed.
COMMAND=$(printf '%s' "$INPUT" \
  | grep -oE '"command"[[:space:]]*:[[:space:]]*"(\\.|[^"\\])*"' \
  | head -1 \
  | sed 's/^"command"[[:space:]]*:[[:space:]]*"//;s/"$//')
if [ -z "$COMMAND" ]; then
  COMMAND=$(printf '%s' "$INPUT" \
    | grep -oE '"command"[[:space:]]*:[[:space:]]*"[^"]*"' \
    | head -1 \
    | sed 's/.*: *"//;s/"//')
fi
[ -z "$COMMAND" ] && exit 0

# Decode JSON-string escape sequences. We MUST decode `\"` and `\\` here
# because the heredoc-marker detector and the quoted-string masker in the
# library both operate on real bash syntax — `<<"EOF"` not `<<\"EOF\"`.
# Order: decode `\"` and `\n`/`\t`/`\r` first via a placeholder for `\\`,
# then restore `\\` to `\` last. The placeholder trick prevents `\\"` (a
# literal backslash followed by a quote in the source command) from being
# mis-decoded as `\` + `"` instead of `\` + `\"`.
# Closes B1 (SCAFREL1/6au3oc review 1): the previous "leave \" and \\ for
# the regex" path left `<<\"EOF\"` in the masker input, the marker detector
# bailed (saw a backslash before the quote), and the heredoc body leaked
# into the scan surface — the literal `git history` prose inside the body
# triggered a false-positive block.
COMMAND=$(printf '%s' "$COMMAND" | sed -e 's/\\\\/\x01/g; s/\\"/"/g; s/\\n/\n/g; s/\\t/\t/g; s/\\r/\r/g; s/\x01/\\/g')

# Build the masked-command text used for the regex scan. Heredoc bodies,
# quoted strings, $(...) and backtick substitutions become neutral
# placeholders (HEREDOC_BODY, QUOTEDARG, CMDSUB) so the `git <subcmd>` scan
# never matches literal `git` substrings inside prose (closes `gnvoxa`).
# Structure (positions, line breaks, segment separators) is preserved so
# `_has_cd_pin_before_match` left-walk semantics still work against the same
# masked stream.
MASKED_COMMAND=$(gitban_mask_command_text "$COMMAND")

# ---------------------------------------------------------------------------
# Classification (library-sourced)
# ---------------------------------------------------------------------------
# Write-class subcommands (canonical list per ADR-051):
#   merge, push, pull, checkout, commit, cherry-pick, rebase, reset,
#   revert, am, rm, mv, restore, update-index, tag, branch, worktree,
#   notes, gc, prune, update-ref, symbolic-ref
# Note: `stash` is read-class per ADR-053 §Decision 3 (folded here per
# ADR-053 design doc blocker 1). The library's `GITBAN_READ_CLASS_RE` is the
# single source of truth — this hook does not maintain a local copy.
#
# Read- and meta-class come from the library:
#   GITBAN_READ_CLASS_RE — log, diff, show, status, ..., stash, etc.
#   GITBAN_META_CLASS_RE — --help, --version, version, help.
#
# Anything not matched by either defaults to write-class
# (conservative-when-in-doubt). The default-write fallback covers
# future-introduced subcommands automatically.

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Escape a string for a JSON string literal. Delegate to the library helper
# (kept as a local alias so the audit-emission code below reads naturally).
_json_escape() { _gitban_json_escape "$1"; }

# ISO-8601 UTC timestamp via the library helper.
_timestamp() { _gitban_timestamp; }

# Operator handle via the library helper.
_handle() { _gitban_handle; }

# Append a JSONL entry to .gitban/audit/cwd_pin_bypasses.jsonl describing a
# bypass-allowed invocation. Schema:
#   {"timestamp", "tool_name", "command", "reason", "handle"}
_write_bypass_audit() {
  local command="$1"
  local reason="$2"
  local row
  row=$(printf '{"timestamp":"%s","tool_name":"Bash","command":"%s","reason":"%s","handle":"%s"}' \
    "$(_json_escape "$(_timestamp)")" \
    "$(_json_escape "$command")" \
    "$(_json_escape "$reason")" \
    "$(_json_escape "$(_handle)")")
  gitban_audit_append ".gitban/audit/cwd_pin_bypasses.jsonl" "$row"
}

# Append a JSONL entry to .gitban/audit/cwd_pin_advisory.jsonl describing an
# advisory-mode allow. Schema:
#   {"timestamp", "tool_name", "command", "offending_subcommand", "handle"}
_write_advisory_audit() {
  local command="$1"
  local subcmd="$2"
  local row
  row=$(printf '{"timestamp":"%s","tool_name":"Bash","command":"%s","offending_subcommand":"%s","handle":"%s"}' \
    "$(_json_escape "$(_timestamp)")" \
    "$(_json_escape "$command")" \
    "$(_json_escape "$subcmd")" \
    "$(_json_escape "$(_handle)")")
  gitban_audit_append ".gitban/audit/cwd_pin_advisory.jsonl" "$row"
}

# Detect a bare `git tag <name>` create/update — `git tag` with no commit
# argument defaults to HEAD, and from a worktree session that HEAD is wrong:
# `git -C "$PARENT" tag <name>` (no SHA) resolves HEAD from the parent's CWD,
# which is the parent's branch HEAD, not the worktree's HEAD. The `-C` pin
# pins the *ref namespace* (which `.git/refs/tags/<name>` the tag lands in);
# it does NOT pin the *target commit* the implicit HEAD resolves to.
#
# Returns 0 (true, block) if `tail` (the substring after `git tag`) is a
# create/update operation lacking an explicit commit-ish argument. Returns
# 1 (false, allow) otherwise — including listing (`-l`/`--list`), deletion
# (`-d`/`--delete`), verification (`-v`/`--verify`), and any form with two
# or more positional arguments (name + commit-ish).
#
# Quote-aware tokenisation: double-quoted, single-quoted, $(...), and
# backtick regions are masked to single placeholders before counting
# positional args, so `"$(git rev-parse HEAD)"` correctly counts as one arg.
# Stops at the first shell command separator (`;`, `|`, `&`).
_is_bare_tag_create() {
  local tail="$1"
  local trimmed masked positional

  # Cut tail at the first command separator so we only inspect the args of
  # this `git tag` invocation.
  trimmed=$(printf '%s' "$tail" | awk '
    {
      s = $0
      best = length(s) + 1
      n = split(";|&", seps, "")
      for (i = 1; i <= n; i++) {
        p = index(s, seps[i])
        if (p > 0 && p < best) best = p
      }
      print substr(s, 1, best - 1)
    }
  ')

  # Listing/deletion/verification forms never have the implicit-HEAD trap.
  if printf '%s' "$trimmed" \
       | grep -qE '(^|[[:space:]])(-l|--list|-d|--delete|-v|--verify)([[:space:]=]|$)'; then
    return 1
  fi

  # Mask balanced quoted regions and command substitutions to single tokens.
  masked=$(printf '%s' "$trimmed" | sed -E '
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

  # Count non-flag positional tokens. Flags that consume the next argument
  # (`-m`/`--message`, `-F`/`--file`, `-u`/`--local-user`) are tracked so
  # their values do not count as positionals.
  positional=$(printf '%s' "$masked" | awk '
    {
      n = 0
      consume = 0
      for (i = 1; i <= NF; i++) {
        if (consume) { consume = 0; continue }
        tok = $i
        if (substr(tok, 1, 1) == "-") {
          if (tok == "-m" || tok == "--message" || \
              tok == "-F" || tok == "--file" || \
              tok == "-u" || tok == "--local-user") {
            consume = 1
          }
          continue
        }
        n++
      }
      print n
    }
  ')

  # Bare create: exactly one positional arg (the name), no list/delete/verify
  # flag. Listing form (no positionals) and explicit-commit form (>=2
  # positionals) are both safe.
  if [ "$positional" = "1" ]; then
    return 0
  fi
  return 1
}

# Classify a subcommand string into "read", "meta", or "write" via the
# library's single-source-of-truth regexes.
_classify_subcommand() {
  gitban_classify_git_subcommand "$1"
}

# Refine the classification based on the flag immediately following the
# subcommand. ADR-051 v1 documents:
#   - `tag -l` is read-class (listing); bare `tag` and `tag <name>` write.
#   - `branch -l` or bare `branch` is read-class; `-D|-d|-m` is write-class.
#   - `worktree list|prune` is read-class; `add|remove|move` is write-class.
#   - `checkout --theirs|--ours` is treated as write-class for v1
#     (conservative -- file-restore-from-index but easier to special-case
#     later than to silently allow now).
# `subcmd` is the matched subcommand; `args` is the rest of the same
# pipeline-or-segment after the subcommand.
_refine_classification() {
  local subcmd="$1"
  local args="$2"
  local first_arg
  # Pull the first whitespace-delimited token of args using bash parameter
  # expansion — no subprocesses. Strip leading whitespace, then take up to
  # the first whitespace.
  local trimmed="${args#"${args%%[![:space:]]*}"}"
  first_arg="${trimmed%%[[:space:]]*}"

  case "$subcmd" in
    tag)
      # `tag -l ...` -> read-class. Anything else -> write-class.
      if [ "$first_arg" = "-l" ] || [ "$first_arg" = "--list" ]; then
        echo "read"
      else
        echo "write"
      fi
      ;;
    branch)
      # `branch` (no flag) or `branch -l`/`--list` -> read-class.
      # Anything starting with `-D`/`-d`/`-m`/`-c`/`-M`/`-C` -> write-class.
      # Other args (e.g. branch creation `branch foo`) -> write-class.
      #
      # Allowlist widening (2026-05-28): the list-filter flags
      # `--merged`/`--no-merged`/`--contains`/`--no-contains`/`--points-at`
      # and the formatting flags `--format`/`--color`/`--column`/`--sort`
      # are purely list-output modifiers — they decorate the same read-only
      # walk that bare `branch` does. Earlier omission caused real-session
      # false positives (operators ran `git branch --merged origin/main`
      # for cleanup audits and got blocked).
      #
      # The `--flag=value` form is matched via glob (`--flag=*`) alongside
      # the separated form (`--flag`) so both `--sort -committerdate` and
      # `--sort=-committerdate` route to read-class.
      case "$first_arg" in
        "" | -l | --list | -a | -r | -v | -vv \
        | --show-current | --all | --remotes \
        | --merged | --merged=* \
        | --no-merged | --no-merged=* \
        | --contains | --contains=* \
        | --no-contains | --no-contains=* \
        | --points-at | --points-at=* \
        | --format | --format=* \
        | --color | --color=* | --no-color \
        | --column | --column=* | --no-column \
        | --abbrev | --abbrev=* | --no-abbrev \
        | --sort | --sort=* \
        | -i | --ignore-case)
          echo "read"
          ;;
        *)
          echo "write"
          ;;
      esac
      ;;
    worktree)
      case "$first_arg" in
        list|prune) echo "read" ;;
        *)          echo "write" ;;
      esac
      ;;
    *)
      _classify_subcommand "$subcmd"
      ;;
  esac
}

# Check whether a `cd "<path>" &&` (or `cd <path> &&`) precedes a given
# git match occurrence in `$cmd`. Returns 0 if the match is preceded by a
# `cd ... &&` token within the same logical segment (split on `;`, `|`,
# `||`, or newline), 1 otherwise.
#
# `cd ... &&` is preserved across `&&` and across following commands until a
# segment-resetting token (`;`, `|`, `||`, newline) appears. This mirrors
# real shell semantics: `cd "$P" && git merge && git push` means both git
# calls run from `$P`. `cd "$P"; git merge` does NOT pin (the `;` resets
# the chain even though `cd` itself persists in shell state -- but the
# mitigation pattern requires the `&&` chain for clarity, and a chain
# broken by `;` is no longer self-evidently pinned in audit logs).
_has_cd_pin_before_match() {
  local cmd="$1"
  local match="$2"
  local prefix
  prefix=$(printf '%s' "$cmd" \
    | awk -v m="$match" '{i=index($0,m); if(i>0){print substr($0, 1, i-1); exit}}')
  [ -z "$prefix" ] && return 1
  local segment
  segment=$(printf '%s' "$prefix" \
    | sed -E ':a; s/^.*[\n;]([^;|\n]*)$/\1/; ta' \
    | sed -E ':a; s/^.*\|\|([^|]*)$/\1/; ta' \
    | sed -E ':a; s/^.*\|([^|]*)$/\1/; ta')
  [ -z "$segment" ] && return 1
  if ! printf '%s' "$segment" | grep -qE '&&[[:space:]]*$'; then
    return 1
  fi
  if printf '%s' "$segment" \
       | grep -qE '(^|[[:space:]])cd[[:space:]]+("[^"]+"|'\''[^'\'']+'\''|[^[:space:]&|;]+)[[:space:]]*&&'; then
    return 0
  fi
  return 1
}

# Emit the bare-tag-create reject message.
_emit_bare_tag_reject_stderr() {
  local match_text="$1"
  echo "BLOCKED: 'git tag <name>' with implicit HEAD (ADR-051)" >&2
  echo "  Offending git invocation: $match_text" >&2
  echo "  'git tag <name>' with no commit argument defaults to HEAD. From a" >&2
  echo "  worktree session, the resolved HEAD is the parent's branch HEAD," >&2
  echo "  not the worktree's HEAD — so the tag lands on the wrong commit," >&2
  echo "  silently. The '-C \"\$PARENT\"' pin places the tag in the correct ref" >&2
  echo "  namespace, but does NOT change which commit HEAD resolves to." >&2
  echo "  Use the canonical form, resolving the SHA from the worktree's CWD:" >&2
  # shellcheck disable=SC2016
  echo '    PARENT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"' >&2
  # shellcheck disable=SC2016
  echo '    git -C "$PARENT" tag <name> "$(git rev-parse HEAD)"' >&2
  echo "  To allow a one-off legitimate invocation (e.g., tagging the parent's" >&2
  # ADR-054 MCP-tool path is the canonical bypass; the env-var read still
  # exists in this file for the v0.X+1 deprecation window but the block
  # message no longer advertises it.
  echo "  HEAD on purpose), call:" >&2
  echo "    mcp__gitban__allow_hook_bypass_once(hook_name=\"cwd-pin-check\", reason=\"...\")" >&2
  echo "  See ADR-051 / ADR-054 for the full rationale." >&2
}

# Emit the standard reject message, naming the offending substring and
# showing the canonical pinned form. Goes to stderr.
_emit_reject_stderr() {
  local subcmd="$1"
  local match_text="$2"
  echo "BLOCKED: unpinned write-class git invocation (ADR-051)" >&2
  echo "  Offending git invocation: $match_text" >&2
  echo "  Subcommand classified as: write-class ($subcmd)" >&2
  echo "  Use the canonical pinned form:" >&2
  # shellcheck disable=SC2016
  echo '    PARENT="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"' >&2
  # shellcheck disable=SC2016
  echo '    git -C "$PARENT" '"$subcmd"' ...' >&2
  echo "  Or the cd-prefix alternative:" >&2
  # shellcheck disable=SC2016
  echo '    cd "$PARENT" && git '"$subcmd"' ...' >&2
  echo "  To allow a one-off legitimate invocation, call:" >&2
  echo "    mcp__gitban__allow_hook_bypass_once(hook_name=\"cwd-pin-check\", reason=\"...\")" >&2
  echo "  See ADR-051 / ADR-054 for the full rationale." >&2
}

# ---------------------------------------------------------------------------
# Main scan — runs against MASKED_COMMAND (heredoc/quote/CMDSUB neutralised)
# ---------------------------------------------------------------------------
# Walk every `git <subcmd>` occurrence in the masked command. The regex
# captures an optional `-C <path>` between `git` and the subcommand so we
# can detect `-C` pinning without a second pass.
#
# Pattern: \bgit\s+(-C\s+\S+\s+)?([a-zA-Z][a-zA-Z0-9-]*)
# Group 1: optional `-C <path> ` (presence -> pinned).
# Group 2: subcommand token.
#
# We extract one match per line and process each.

REJECTED=0
REJECTED_SUBCMD=""
REJECTED_MATCH=""
REJECTED_REASON=""

MATCHES=$(printf '%s' "$MASKED_COMMAND" \
  | grep -oE '\bgit[[:space:]]+(-C[[:space:]]+("[^"]+"|'\''[^'\'']+'\''|[^[:space:]]+)[[:space:]]+)?[a-zA-Z][a-zA-Z0-9-]*' \
  || true)

if [ -z "$MATCHES" ]; then
  exit 0
fi

# Flatten newlines for the cursor-based tail extraction. The awk extraction
# below uses `index()` per record, which would behave incorrectly with a
# global cursor on multi-line input (cursor offsets reset per line). Newlines
# are semantically equivalent to spaces for both the regex scan and the
# subcommand-arg refinement, so flattening here is safe. We keep
# MASKED_COMMAND (multi-line) for `_has_cd_pin_before_match` which is
# segment-aware and needs the line structure.
SCAN_TEXT=$(printf '%s' "$MASKED_COMMAND" | tr '\n' ' ')

# Remaining is the unscanned suffix of SCAN_TEXT. Each iteration locates the
# current match in $remaining via bash native ${var#*pattern} (no subprocess),
# extracts the tail substring after it, and advances `remaining` past the
# match. This replaces the previous per-iteration awk calls that were the
# main hot-loop cost on Git Bash MSYS (each awk spawn is ~300-500ms; a
# 4-match block produced 12+s).
remaining="$SCAN_TEXT"
while IFS= read -r match; do
  [ -z "$match" ] && continue

  # Subcommand is the last whitespace-delimited token of the match.
  # Use bash parameter expansion (no subprocess).
  subcmd="${match##* }"

  # Find $match in $remaining. ${remaining#*"$match"} strips everything up to
  # and including the first occurrence — leaving the tail. Note the quoting:
  # bash treats $match as a literal pattern here because we use "$match"
  # inside the parameter expansion (no glob expansion).
  case "$remaining" in
    *"$match"*)
      tail_after="${remaining#*"$match"}"
      # Keep only the first 200 chars of tail to cap per-iteration cost.
      tail_after="${tail_after:0:200}"
      # Advance remaining: drop everything up to AND including this match.
      remaining="${remaining#*"$match"}"
      ;;
    *)
      # Match not found in remaining — should not happen since matches came
      # from grep over the same source. Skip defensively.
      continue
      ;;
  esac

  # Bare-tag check applies regardless of pinning state.
  if [ "$subcmd" = "tag" ] && _is_bare_tag_create "$tail_after"; then
    REJECTED=1
    REJECTED_REASON="bare-tag"
    REJECTED_SUBCMD="$subcmd"
    REJECTED_MATCH="$match"
    break
  fi

  # `-C` pinning detection: the match itself begins with `git -C ...` if the
  # regex captured the pin token sequence. Use bash glob match (no subprocess).
  case "$match" in
    "git -C "*|"git "*"-C "*)
      # The second pattern guards against future regex tweaks that might
      # capture additional whitespace before `-C`.
      continue
      ;;
  esac

  cls=$(_refine_classification "$subcmd" "$tail_after")

  case "$cls" in
    read|meta)
      continue
      ;;
    write)
      # Last-chance check: a `cd "..." &&` chain that immediately precedes
      # the git invocation in the same segment. Scan against MASKED_COMMAND
      # so a `cd ... &&` inside a heredoc body or quoted string doesn't
      # spuriously pin.
      if _has_cd_pin_before_match "$MASKED_COMMAND" "$match"; then
        continue
      fi
      REJECTED=1
      REJECTED_SUBCMD="$subcmd"
      REJECTED_MATCH="$match"
      break
      ;;
  esac
done <<< "$MATCHES"

if [ "$REJECTED" = "0" ]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Decision: reject, advisory-log, or bypass-allow
# ---------------------------------------------------------------------------
MODE="${GITBAN_CWD_PIN_HOOK_MODE:-enforce}"

if [ "${GITBAN_ALLOW_CWD_PIN_BYPASS:-}" = "1" ]; then
  if [ "$REJECTED_REASON" = "bare-tag" ]; then
    _write_bypass_audit "$COMMAND" "bare-tag-create:$REJECTED_SUBCMD"
    echo "WARNING: bare 'git tag <name>' allowed by GITBAN_ALLOW_CWD_PIN_BYPASS=1." >&2
  else
    _write_bypass_audit "$COMMAND" "unpinned-write-class:$REJECTED_SUBCMD"
    echo "WARNING: unpinned git allowed by GITBAN_ALLOW_CWD_PIN_BYPASS=1." >&2
  fi
  echo "  Offending invocation: $REJECTED_MATCH" >&2
  echo "  Audit entry written to .gitban/audit/cwd_pin_bypasses.jsonl." >&2
  gitban_audit_mark_bypass "GITBAN_ALLOW_CWD_PIN_BYPASS" "$REJECTED_MATCH"
  exit 0
fi

if [ "$MODE" = "advisory" ]; then
  _write_advisory_audit "$COMMAND" "$REJECTED_SUBCMD"
  gitban_audit_mark_advisory "$REJECTED_MATCH"
  if [ "$REJECTED_REASON" = "bare-tag" ]; then
    echo "NOTICE: bare 'git tag <name>' in advisory mode (GITBAN_CWD_PIN_HOOK_MODE=advisory)." >&2
  else
    echo "NOTICE: unpinned write-class git in advisory mode (GITBAN_CWD_PIN_HOOK_MODE=advisory)." >&2
  fi
  echo "  Offending invocation: $REJECTED_MATCH" >&2
  echo "  This will become an error in the next release." >&2
  echo "  Audit entry written to .gitban/audit/cwd_pin_advisory.jsonl." >&2
  exit 0
fi

# Default: enforce -> reject.
gitban_audit_mark_block "$REJECTED_MATCH"
if [ "$REJECTED_REASON" = "bare-tag" ]; then
  _emit_bare_tag_reject_stderr "$REJECTED_MATCH"
else
  _emit_reject_stderr "$REJECTED_SUBCMD" "$REJECTED_MATCH"
fi
exit 2
