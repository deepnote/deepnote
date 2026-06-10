#!/bin/bash
# PreToolUse hook: logs every tool call to a per-agent trace file.
# Wire this into agent frontmatter on matcher "*" to capture all tool activity.
#
# Log locations:
#   .gitban/agents/traces/agent-{session_id_12}.jsonl   (per-agent file, watchdog target)
#   .gitban/agents/traces/session-{date}.jsonl          (shared session file, backward compat)
#
# Each line is a JSON object with: timestamp, tool_name, tool_input (truncated),
# and the session id so downstream tools can correlate tool calls to an agent.
#
# Set AGENT_TRACE=0 to disable tracing entirely.
# Set AGENT_TRACE_VERBOSE=1 to log full tool_input (no truncation).
# Default: tracing on, values truncated to 200 chars.
#
# IMPORTANT: `session_id` is the reliable per-agent discriminator in Claude
# Code PreToolUse hook payloads. The fields `agent_id` and `agent_type` are
# NOT populated by the platform — any hook relying on them silently degrades
# (all tool calls landed in the shared session-{date}.jsonl, per-agent files
# were never created, and the watchdog could never find a matching file).
# See EXTFB card qm53xi (2026-04-08) for the original diagnosis.

if [ "${AGENT_TRACE:-1}" = "0" ]; then
  exit 0
fi

INPUT=$(cat)

# Resolve git root (works from worktrees too)
GIT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
MAIN_REPO="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
MAIN_REPO="${MAIN_REPO%/.git}"
if [ -z "$MAIN_REPO" ]; then
  MAIN_REPO="$GIT_ROOT"
fi

TRACE_DIR="$MAIN_REPO/.gitban/agents/traces"
mkdir -p "$TRACE_DIR"

VERBOSE="${AGENT_TRACE_VERBOSE:-0}"

# Find python
PYTHON=""
for candidate in "$MAIN_REPO/.venv/Scripts/python.exe" "$MAIN_REPO/.venv/bin/python" "$GIT_ROOT/.venv/Scripts/python.exe" "$GIT_ROOT/.venv/bin/python" python3 python; do
  if { [ -x "$candidate" ] 2>/dev/null || command -v "$candidate" &>/dev/null; } && "$candidate" -c "" >/dev/null 2>&1; then
    PYTHON="$candidate"
    break
  fi
done

if [ -z "$PYTHON" ]; then
  exit 0
fi

"$PYTHON" -c "
import json, sys, datetime, os

try:
    data = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)

verbose = sys.argv[3] == '1'
tool_name = data.get('tool_name', 'unknown')
tool_input = data.get('tool_input', {})
session_id = data.get('session_id', '')
ts = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

# Build summary of tool_input
if verbose:
    summary = {k: str(v) for k, v in tool_input.items()}
else:
    summary = {}
    for k, v in tool_input.items():
        s = str(v)
        if len(s) > 200:
            s = s[:200] + '...'
        summary[k] = s

trace_dir = sys.argv[2]

# Shared session file (backward compat)
shared_path = os.path.join(trace_dir, f'session-{ts[:10]}.jsonl')

# Per-agent file keyed on session_id (watchdog target). If session_id is
# missing (older platform version), write only to the shared file — the
# watchdog's Strategy-2 recency fallback still finds newest activity.
per_agent_path = None
if session_id:
    short_sid = session_id[:12].replace('/', '_').replace('\\\\', '_')
    per_agent_path = os.path.join(trace_dir, f'agent-{short_sid}.jsonl')

entry = {
    'ts': ts,
    'tool': tool_name,
    'input': summary,
}
if session_id:
    entry['session'] = session_id[:12]

line = json.dumps(entry, separators=(',', ':')) + '\n'

with open(shared_path, 'a', encoding='utf-8') as f:
    f.write(line)

if per_agent_path:
    with open(per_agent_path, 'a', encoding='utf-8') as f:
        f.write(line)
" "$INPUT" "$TRACE_DIR" "$VERBOSE" 2>/dev/null

exit 0
