<!--
  Source for the client's `.gitban/README.md` — the front door GitHub renders
  when anyone opens `.gitban/`, and the onboarding brief for a Claude Code
  terminal working in this repo.

  Shipped and refreshed by `gitban setup` (reference material, not user state).
  Keep it a fast on-ramp that POINTS at the deep docs — the full workflow lives
  in `docs/development-lifecycle.md`, conventions in `CLAUDE.md`. Self-contained
  by rule: no internal "ADR-NNN" citations, no `docs/adr/` links, and no
  hardcoded tool/skill/agent counts (they drift — describe roles, not numbers).
-->

# gitban — this project's board lives in git

**gitban** turns your repository into an agile board for AI agents and humans.
Every card is a markdown file under `.gitban/cards/`, every state change is a
filename rename, and every sprint archive is a folder you can `grep`. On top of
the board sits an optional **agent scaffold** (in `.claude/`) that lets Claude
Code — or any MCP-compatible harness — plan, build, review, and ship work
through structured, self-checking workflows.

If you can see this file, `gitban setup` already ran. Here's how to start.

---

## Quick start

**1. Confirm gitban is connected.** Ask Claude to run `health_check` (or
`get_help`). If gitban's tools aren't available, copy the `mcpServers.gitban`
block from `.gitban/claude-mcp-setup.example.json` into your Claude Code MCP
config and restart Claude Code. Everything below depends on this.

**2. See the board** — ask Claude, or call the MCP tools directly:

| To… | Use |
|---|---|
| See the board | `render_board` · `list_cards` |
| See the roadmap | `render_roadmap` · `read_roadmap` |
| Read a card | `read_card` |
| Ask gitban anything | `get_help` · `search_help` |

**3. Do work.** Two ways in (skills prefixed with `/` are slash commands *you*
type — see the agent note below):

- **Quick card** → ask Claude to `create_card`, then run **`/dispatcher`** on it.
- **A body of work** → plan it first (PRD → ADR → design doc via the writer
  skills), run **`/sprint-architect`** to turn the plan into cards, then run
  **`/dispatcher`** to execute the sprint.

**Finish setup once** (before you commit anything):

```bash
# Sample conventions: review .claude/CLAUDE.md.gitban and merge the parts you
# want into your project's CLAUDE.md (gitban never touches your CLAUDE.md).
grep -qxF -f .gitignore.gitban .gitignore 2>/dev/null \
  || cat .gitignore.gitban >> .gitignore  # ignore gitban's runtime artifacts (safe to re-run)
```

---

## If you're the AI agent working in this repo

A short operating brief — read `docs/development-lifecycle.md` for the full model.

- **The board is your memory.** You are stateless; the cards are not. Before
  starting, `read_card` for the full context, plan, test strategy, and the
  card's **definition of done** (its hard, checkable requirements).
- **Mutate state only through gitban's MCP tools** (`create_card`, `edit_card`,
  `move_to_todo`, `complete_card`, `upsert_roadmap`, …). Never hand-edit files
  under `.gitban/cards/`, `.gitban/roadmap/`, or `.gitban/audit/` — a hook will
  block it, because direct edits bypass validation and corrupt the board.
- **A card isn't done until its requirements are.** Completion is gated: you
  cannot mark a card done while a non-deferred checkbox is unchecked.
- **Slash-command skills (`/dispatcher`, `/pr`, the writer skills) are invoked
  by the human, not by you.** You don't self-trigger them — your job is the work
  inside whatever skill dispatched you. State lives in git, so any session can
  resume where another stopped.

---

## What `gitban setup` put in your repo

```
your-project/
├── .gitban/                ← the board + gitban infrastructure (you are here)
│   ├── README.md           this file
│   ├── cards/              every card is a markdown file; the filename is its state
│   │   └── archive/        completed sprints, kept and grep-able forever
│   ├── roadmap/            the strategic spine; planned & done work hangs off it
│   ├── docs/               reference docs — start with development-lifecycle.md
│   ├── templates/          card templates + their own README (authoring guide)
│   ├── hooks/              the protective hooks the scaffold installs (below)
│   ├── scaffold.example.yaml      copy to scaffold.yaml to tune the agent scaffold
│   └── claude-mcp-setup.example.json   the MCP-server connection config (step 1)
├── .claude/                ← the agent scaffold (optional, recommended)
│   ├── skills/             the planning + execution skills (see the lifecycle doc)
│   ├── agents/             the agent definitions those skills dispatch
│   └── CLAUDE.md.gitban    sample conventions — merge into your CLAUDE.md
└── .gitignore.gitban       sample ignores (repo root, next to your .gitignore) — merge in
```

*(Illustrative — the most useful paths, not an exhaustive listing.)*

### What to commit vs. ignore

Commit your **board and config** — `.gitban/cards/`, `.gitban/roadmap/`,
`.gitban/templates/`, `.gitban/docs/`, and `.claude/`. These are your project's
shared state and should travel with the repo.

Do **not** commit gitban's **runtime artifacts** — agent traces, logs, rendered
HTML views, the local audit log. `.gitignore.gitban` lists exactly
these; merging it into your `.gitignore` (Quick start) keeps them out of git.

---

## Customize it for your project

Three levers, smallest to largest:

1. **`CLAUDE.md`** — the project-wide brief every agent reads each session. Put
   your test runner, commit rules, build/deploy commands, and key context here.
   Merge in the sample from `.claude/CLAUDE.md.gitban`; your `CLAUDE.md` is
   never overwritten by `gitban setup`.
2. **`.gitban/scaffold.yaml`** — tune the agent scaffold without forking it. Copy
   `scaffold.example.yaml` to `scaffold.yaml` and set `variables:` (e.g. your
   git handle, your venv command) or `overrides:` to swap a shared fragment
   (like the conventions block) injected across multiple skills.
3. **`.claude/skills/<skill>/SKILL.local.md`** — per-skill, system-specific
   additions. Create this file next to any skill and its content is appended to
   that skill on every deploy. It's yours: `gitban setup` never overwrites it.

Re-run **`gitban setup --force`** after upgrading gitban to refresh the shipped
skills, hooks, and docs. Your `CLAUDE.md`, `scaffold.yaml`, and `SKILL.local.md`
overlays are always preserved.

---

## What the hooks do

The scaffold wires a few lightweight hooks into `.claude/settings.json`. Out of
the box they:

- **Protect the board** — block any direct, non-MCP write to hard-protected
  state (`.gitban/cards/`, `.gitban/roadmap/`, `.gitban/audit/`) so it can't be
  silently corrupted; advise on soft-protected paths.
- **Keep git safe in worktrees** — pin write-class git operations to the parent
  worktree (so a card's work commits to the right branch) and fork new agent
  worktrees from your current HEAD rather than stale `origin/main`.
- **Trace the agents** — log each agent's tool calls to a per-agent trace, which
  the dispatch loop's watchdog reads to detect and recover a stalled agent.

One extra ships but is **not** auto-enforced: the per-agent watchdog the
dispatcher launches during a sprint. You generally never touch it.

---

## Card templates

Templates are the structural anchors that make a card's "done" enforceable —
required headings, checkboxes (TDD, testing, rollback), and acceptance criteria
that validation checks on creation and completion. **The shipped templates cover
the standard card types thoroughly, so you rarely need to author your own.**

If you do want a project-specific variant (e.g. `bug-production`, `feat-api`):

- **Agent-driven:** ask Claude — it can scaffold an example with the
  `generate_template_example` tool, then write and validate the new
  `.gitban/templates/<type>-<variant>.md`.
- **Human-driven:** gitban also ships the `create-template`, `edit-template`,
  and `suggest-template` MCP **prompts**, which Claude Code surfaces as
  slash commands *you* trigger (an agent can't invoke a prompt on its own).

See `templates/README.md` for the naming convention and authoring guide.

---

## How work flows

Four phases, all anchored on the roadmap:

1. **Plan** — shape the work as documents (PRD → ADR → design doc), each written
   and adversarially reviewed by paired skills. *This is the phase to involve
   your team — the harness builds whatever the docs say.*
2. **Decompose** — `/sprint-architect` turns the plan into a sprint of cards,
   each baking in context, a plan, a test strategy, and a definition of done.
3. **Execute** — `/dispatcher` runs a loop of fresh, stateless agents
   (executor → reviewer → router → planner) in isolated worktrees, crash-safe
   and resumable.
4. **Land** — close out the sprint and open a PR with the **`/pr`** skill.

**→ The full pipeline, the skills for each phase, and the diagrams are in
[`docs/development-lifecycle.md`](docs/development-lifecycle.md).**

---

## Where to look next

| You want to… | Look at |
|---|---|
| Understand the whole workflow | [`docs/development-lifecycle.md`](docs/development-lifecycle.md) |
| Set conventions for agents | `CLAUDE.md` |
| Tune the agent scaffold | `.gitban/scaffold.example.yaml` → `scaffold.yaml` |
| Author or customize templates | [`templates/README.md`](templates/README.md) |
| See what a skill does | `.claude/skills/<skill-name>/SKILL.md` |
| Ask gitban directly | the `get_help` and `search_help` MCP tools |
