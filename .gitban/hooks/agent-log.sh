#!/usr/bin/env bash
# agent-log.sh - Structured JSONL profiling utility for gitban agents
#
# Source this script from any bash context to emit structured timing data.
# Output format: JSONL (one JSON object per line) for machine parsing.
#
# Required environment variables (export before sourcing; the AGENT_* env is the
# durable contract — the helpers re-derive the log path from it on every call):
#   AGENT_LOG_DIR    - Directory for log files (created if missing)
#   AGENT_ROLE       - Agent role (executor, reviewer, router, etc.)
#   AGENT_SPRINT_TAG - Sprint tag (e.g., AGENTLOG)
#   AGENT_CARD_ID    - Card ID (e.g., n8ead7)
#   AGENT_CYCLE      - Review cycle number (e.g., 1)
#
# Log path: $AGENT_LOG_DIR/{SPRINT_TAG}-{CARD_ID}-{ROLE}-{CYCLE}.jsonl
#
# Stateless-shell resilience:
#   The Claude Code Bash tool runs each call in a fresh shell, so the in-shell
#   $_AGENT_LOG_FILE that agent_log_init sets does NOT persist to the next call.
#   To survive this, every write helper (cmd/event/summary) self-resolves the
#   log path from the exported AGENT_* env when $_AGENT_LOG_FILE is unset, using
#   the SAME formula as agent_log_init (idempotent — events from any shell append
#   to the one canonical file). Calling agent_log_init once per logical run is
#   still recommended (it writes the header + sentinel and resets counters), but
#   logging from a shell that never ran init now appends correctly instead of
#   erroring. No combined "init + log in one shell" round-trip is required.
#
# Functions:
#   agent_log_init    - Create log file, write header entry
#   agent_log_cmd     - Run a command, capture duration and exit code
#   agent_log_event   - Write a manual JSONL entry with label + metadata
#   agent_log_summary - Write summary with totals (commands, failures, time)
#
# Example usage:
#   export AGENT_LOG_DIR=".gitban/agents/executor/logs"
#   export AGENT_ROLE="executor"
#   export AGENT_SPRINT_TAG="SPRINT1"
#   export AGENT_CARD_ID="abc123"
#   export AGENT_CYCLE="1"
#   source .gitban/hooks/agent-log.sh
#   agent_log_init
#   agent_log_cmd "git commit -m 'feat: add widget'"
#   agent_log_event "hook-fix" '{"attempt":2}'
#   agent_log_summary
#
# Portability: Uses only POSIX-compatible constructs plus bash SECONDS.
# Tested on MSYS2/Git Bash (Windows) and standard Linux bash.

# Internal state
_AGENT_LOG_FILE=""
_AGENT_LOG_CMD_COUNT=0
_AGENT_LOG_FAIL_COUNT=0
_AGENT_LOG_TOTAL_DURATION=0
_AGENT_LOG_INIT_SECONDS=0

# _agent_log_timestamp - portable ISO 8601 timestamp
# Uses date command; works on GNU and BSD/MSYS2.
_agent_log_timestamp() {
    date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date +"%Y-%m-%dT%H:%M:%S"
}

# _agent_log_derive_path - compute the canonical log-file path from AGENT_* env.
# MUST stay byte-for-byte identical to the path agent_log_init computes for the
# same AGENT_* values, so init and self-init resolve to the same file. Prints
# the absolute path on stdout; returns non-zero (without aborting the caller) if
# any required var is unset. Does NOT write a header, touch counters, or write
# the sentinel — it only resolves the path.
_agent_log_derive_path() {
    local log_dir="${AGENT_LOG_DIR:-}"
    local role="${AGENT_ROLE:-}"
    local sprint="${AGENT_SPRINT_TAG:-}"
    local card_id="${AGENT_CARD_ID:-}"
    local cycle="${AGENT_CYCLE:-}"
    if [ -z "$log_dir" ] || [ -z "$role" ] || [ -z "$sprint" ] || \
       [ -z "$card_id" ] || [ -z "$cycle" ]; then
        return 1
    fi
    mkdir -p "$log_dir" 2>/dev/null || true
    printf '%s' "$(cd "$log_dir" && pwd)/${sprint}-${card_id}-${role}-${cycle}.jsonl"
}

# _agent_log_write - append a raw JSON string to the log file.
# Self-heals across stateless Bash tool shells: if $_AGENT_LOG_FILE is empty
# (this shell never ran agent_log_init), re-derive it from the exported AGENT_*
# env so the event still lands in the canonical file instead of erroring.
_agent_log_write() {
    local json_str="$1"
    if [ -z "$_AGENT_LOG_FILE" ]; then
        _AGENT_LOG_FILE="$(_agent_log_derive_path)" || {
            echo "agent-log: cannot resolve log path; AGENT_* env not set" >&2
            return 1
        }
    fi
    echo "$json_str" >> "$_AGENT_LOG_FILE"
}

# _agent_log_escape - escape a string for safe JSON embedding
# Handles backslashes, double quotes, newlines, tabs, carriage returns.
_agent_log_escape() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\t'/\\t}"
    s="${s//$'\r'/\\r}"
    printf '%s' "$s"
}

# agent_log_init - create log file and write header entry
# Reads from environment: AGENT_LOG_DIR, AGENT_ROLE, AGENT_SPRINT_TAG,
#                          AGENT_CARD_ID, AGENT_CYCLE
agent_log_init() {
    local log_dir="${AGENT_LOG_DIR:?AGENT_LOG_DIR must be set}"
    local role="${AGENT_ROLE:?AGENT_ROLE must be set}"
    local sprint="${AGENT_SPRINT_TAG:?AGENT_SPRINT_TAG must be set}"
    local card_id="${AGENT_CARD_ID:?AGENT_CARD_ID must be set}"
    local cycle="${AGENT_CYCLE:?AGENT_CYCLE must be set}"

    # Reset counters
    _AGENT_LOG_CMD_COUNT=0
    _AGENT_LOG_FAIL_COUNT=0
    _AGENT_LOG_TOTAL_DURATION=0
    _AGENT_LOG_INIT_SECONDS=$SECONDS

    # Create directory if needed
    mkdir -p "$log_dir"

    # Set log file path (absolute so hooks can find it from any cwd).
    # Derived via the shared helper so init and stateless-shell self-init
    # always resolve to the same file.
    _AGENT_LOG_FILE="$(_agent_log_derive_path)"

    # Write header entry
    local ts
    ts="$(_agent_log_timestamp)"
    _agent_log_write "{\"timestamp\":\"${ts}\",\"operation\":\"init\",\"role\":\"${role}\",\"sprint\":\"${sprint}\",\"card_id\":\"${card_id}\",\"cycle\":${cycle}}"

    # Write sentinel for PostToolUse hook auto-logging.
    # Use git-common-dir to find the main repo root (not the worktree root).
    # The hook in .claude/settings.json runs from the main repo, so the
    # sentinel must be there for both sides to agree.
    local main_repo
    main_repo="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
    main_repo="${main_repo%/.git}"  # strip trailing /.git
    if [ -z "$main_repo" ]; then
      main_repo="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
    fi
    mkdir -p "$main_repo/.gitban/agents"
    echo "$_AGENT_LOG_FILE" > "$main_repo/.gitban/agents/.active-log"
}

# agent_log_cmd - run a command, capture duration and exit code, write JSONL
# Args: command string to execute via eval
# Returns: the exit code of the command
agent_log_cmd() {
    local cmd="$1"
    local start_s=$SECONDS
    local exit_code=0

    # Run the command, capturing exit code
    eval "$cmd" || exit_code=$?

    local end_s=$SECONDS
    local duration=$((end_s - start_s))

    # Update counters
    _AGENT_LOG_CMD_COUNT=$((_AGENT_LOG_CMD_COUNT + 1))
    _AGENT_LOG_TOTAL_DURATION=$((_AGENT_LOG_TOTAL_DURATION + duration))
    if [[ "$exit_code" -ne 0 ]]; then
        _AGENT_LOG_FAIL_COUNT=$((_AGENT_LOG_FAIL_COUNT + 1))
    fi

    # Write entry
    local ts escaped_cmd
    ts="$(_agent_log_timestamp)"
    escaped_cmd="$(_agent_log_escape "$cmd")"
    _agent_log_write "{\"timestamp\":\"${ts}\",\"operation\":\"cmd\",\"command\":\"${escaped_cmd}\",\"duration_s\":${duration},\"exit_code\":${exit_code}}"

    return "$exit_code"
}

# agent_log_event - write a manual JSONL entry
# Args:
#   $1 - label (string identifier for the event)
#   $2 - metadata (optional JSON object string, default "{}")
agent_log_event() {
    local label="$1"
    local metadata="$2"
    if [[ -z "$metadata" ]]; then metadata="{}"; fi

    local ts escaped_label
    ts="$(_agent_log_timestamp)"
    escaped_label="$(_agent_log_escape "$label")"
    _agent_log_write "{\"timestamp\":\"${ts}\",\"operation\":\"event\",\"label\":\"${escaped_label}\",\"metadata\":${metadata}}"
}

# agent_log_summary - write summary entry with totals
# Call this at the end of an agent run to record aggregate metrics.
agent_log_summary() {
    local elapsed=$((SECONDS - _AGENT_LOG_INIT_SECONDS))
    local ts
    ts="$(_agent_log_timestamp)"
    _agent_log_write "{\"timestamp\":\"${ts}\",\"operation\":\"summary\",\"total_commands\":${_AGENT_LOG_CMD_COUNT},\"failed_commands\":${_AGENT_LOG_FAIL_COUNT},\"total_duration_s\":${elapsed}}"

    # Clean up sentinel (main repo, not worktree)
    local main_repo
    main_repo="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
    main_repo="${main_repo%/.git}"
    if [ -z "$main_repo" ]; then
      main_repo="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
    fi
    rm -f "$main_repo/.gitban/agents/.active-log"
}
