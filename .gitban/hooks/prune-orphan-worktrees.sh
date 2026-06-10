#!/usr/bin/env bash
# Sweep orphan worktree directories under .claude/worktrees/.
#
# Why this exists: on Windows, the dispatcher's normal worktree cleanup
# sequence (`git worktree remove --force` + `git branch -D` + `git worktree
# prune`) frequently fails to delete the physical directory. The OS retains
# file handles on transient files left inside the worktree (bash.exe.stackdump,
# sub-agent log files, .git internals) after the executor process exits, so
# `git worktree remove --force` reports "Permission denied" and a follow-up
# `rm -rf` reports "Device or resource busy". Git's metadata is cleaned (the
# branch is deleted and `git worktree prune` succeeds), but the directory
# lingers on disk. Over a long sprint these orphan `agent-*` dirs pile up and
# obscure which worktrees are actually live.
#
# Two orphan shapes are handled:
#   (a) git-registered orphans — still appear in `git worktree list` (e.g. a
#       cancelled WorktreeCreate hook, anthropics/claude-code#62422). These are
#       unlocked + removed + pruned so git stops tracking them.
#   (b) physical-directory orphans — git no longer tracks them (not in
#       `git worktree list`) but the directory is locked on disk and resists
#       rm. These are retried; persistent locks are reported at INFO, not
#       errored.
#
# This sweep is idempotent and non-destructive to LIVE worktrees: any directory
# that `git worktree list --porcelain` still reports as a tracked worktree is
# skipped, so running the sweep mid-dispatch never removes an executor's
# active worktree.
#
# Usage:
#   bash .gitban/hooks/prune-orphan-worktrees.sh [--quiet]
#
# Exit status is always 0 — a locked directory is expected on Windows and is
# NOT a failure. The sweep reports counts (cleaned / remaining-locked / skipped
# live) on stdout and per-directory detail at INFO on stderr.
#
# Designed to be run at dispatcher session start (Phase 0 pre-step) and at
# session end. Safe to run on any platform; on Linux/macOS where rm always
# succeeds, the "remaining locked" count is normally zero.

set -uo pipefail

QUIET=false
if [[ "${1:-}" == "--quiet" ]]; then
  QUIET=true
fi

log_info() {
  # INFO-level diagnostics go to stderr so stdout stays parseable.
  $QUIET || echo "prune-orphan-worktrees [INFO]: $*" >&2
}

# Resolve the parent repo's working-tree root regardless of which worktree (or
# worktree subdirectory) the shell's CWD has drifted into (ADR-051). Using
# --git-common-dir (not --show-toplevel) keeps the resolver pinned to the
# parent repo even when invoked from inside a worktree.
COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)" || {
  echo "prune-orphan-worktrees [ERROR]: not inside a git repository" >&2
  exit 0
}
PARENT="$(dirname "$COMMON_DIR")"

WORKTREES_DIR="$PARENT/.claude/worktrees"

if [[ ! -d "$WORKTREES_DIR" ]]; then
  log_info "no .claude/worktrees/ directory at $WORKTREES_DIR — nothing to sweep"
  echo "prune-orphan-worktrees: cleaned=0 locked=0 skipped_live=0"
  exit 0
fi

# Prune git's own stale worktree metadata first. This converts shape-(a)
# git-registered orphans whose directories are already gone into a clean
# state, and leaves only genuinely-tracked worktrees in `git worktree list`.
git -C "$PARENT" worktree prune 2>/dev/null || true

# Collect the set of directories git still considers LIVE worktrees. We must
# never delete these — they may belong to a currently-running executor.
# `git worktree list --porcelain` emits one `worktree <path>` line per entry.
declare -A LIVE_PATHS=()
while IFS= read -r line; do
  case "$line" in
    "worktree "*)
      wt_path="${line#worktree }"
      # Normalise to a comparable absolute form. git emits native paths
      # (forward slashes on Windows via Git for Windows).
      LIVE_PATHS["$wt_path"]=1
      ;;
  esac
done < <(git -C "$PARENT" worktree list --porcelain 2>/dev/null)

cleaned=0
locked=0
skipped_live=0

# Iterate physical agent-* directories. Use a glob; if none match, the loop
# body is skipped (nullglob-style guard via existence test).
shopt -s nullglob 2>/dev/null || true
for dir in "$WORKTREES_DIR"/agent-*; do
  [[ -d "$dir" ]] || continue

  # Is this directory a live, git-tracked worktree? Compare against the
  # porcelain list. git may report the path with a trailing-slash difference
  # or differing separator; check both the raw and a slash-normalised form.
  dir_norm="${dir%/}"
  if [[ -n "${LIVE_PATHS[$dir_norm]:-}" || -n "${LIVE_PATHS[$dir]:-}" ]]; then
    log_info "skipping live worktree (git-tracked): $dir_norm"
    skipped_live=$((skipped_live + 1))
    continue
  fi

  # Shape-(a) safety net: if git somehow still tracks this path under a
  # different normalisation, try an explicit unlock + remove before falling
  # back to rm. Both are best-effort; failures are swallowed.
  git -C "$PARENT" worktree unlock "$dir_norm" 2>/dev/null || true
  git -C "$PARENT" worktree remove --force "$dir_norm" 2>/dev/null || true

  # If git's remove cleared the directory, count it and move on.
  if [[ ! -d "$dir_norm" ]]; then
    log_info "removed git-registered orphan via worktree remove: $dir_norm"
    cleaned=$((cleaned + 1))
    continue
  fi

  # Shape-(b): physical-directory orphan. Attempt rm. On Windows a retained
  # handle yields "Permission denied" / "Device or resource busy" — that is
  # expected and NOT an error; we log it at INFO and count it as locked.
  if rm -rf "$dir_norm" 2>/dev/null && [[ ! -d "$dir_norm" ]]; then
    log_info "removed orphan directory: $dir_norm"
    cleaned=$((cleaned + 1))
  else
    log_info "directory locked (handle still held by OS), leaving for next sweep: $dir_norm"
    locked=$((locked + 1))
  fi
done

# Final metadata prune in case any worktree remove above succeeded.
git -C "$PARENT" worktree prune 2>/dev/null || true

echo "prune-orphan-worktrees: cleaned=$cleaned locked=$locked skipped_live=$skipped_live"
exit 0
