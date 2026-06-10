<!--
  Shipped by `gitban setup` to `.gitban/docs/development-lifecycle.md`.

  This is the canonical, client-facing description of how development works
  in a gitban-scaffolded repository. It is refreshed on every `gitban setup`
  (it is reference material, not user state) — edit the conventions and
  per-project specifics in CLAUDE.md, not here.

  Self-contained by rule: this file ships into repositories that carry no
  internal ADR archive, so it cites no internal "ADR-NNN" numbers and links
  to no `docs/adr/` path. Where a rule needs justification, the rationale is
  stated inline.
-->

# Development Lifecycle

This repository is set up to develop software with a roadmap-anchored,
agent-driven workflow. Work moves through four phases — **Plan → Decompose →
Execute → Land** — and the gitban roadmap is the spine the whole thing hangs
from.

The core idea: **engage humans heavily while the work is still words, then let
a disposable-agent harness build exactly what those words say.** Requirements,
architecture, and design are where judgment matters most and where mistakes are
cheapest to fix; once they are settled, execution becomes a mechanical,
self-checking pipeline.

## The big picture

The **roadmap** (`.gitban/roadmap/`) is the scaffold for everything. Its nodes
(milestone → story → project → feature) are where planned and completed work
hangs. During planning you attach documents to roadmap nodes via their metadata
(e.g. `docs_ref`), so every artifact is traceable from strategic vision down to
the line of code that delivered it.

```
  ROADMAP  (the spine — planned & completed work hangs off node metadata)
    │
    ▼
  ┌─────────────┐     ┌──────────────┐     ┌───────────────┐     ┌─────────┐
  │  1. PLAN    │ ──► │ 2. DECOMPOSE │ ──► │  3. EXECUTE   │ ──► │ 4. LAND │
  │  PRD/ADR/   │     │  sprints &   │     │  dispatch     │     │ closeout│
  │  design     │     │  cards       │     │  loop         │     │ + PR    │
  └─────────────┘     └──────────────┘     └───────────────┘     └─────────┘
   human-orchestrated  human-orchestrated   autonomous            human-triggered
   (writer↔reviewer)   (architect↔reviewer) (stateless agents)    (pr skill)
```

A few principles run through all four phases:

- **Disposable, stateless agents.** Each unit of execution is handled by a
  fresh agent that reads its context, does the work, and exits. Nothing
  important lives in an agent's head, so there is no context rot and no
  long-lived session to corrupt.
- **Git is the state bus.** Agents do not message each other directly. They
  coordinate through shared, durable state — the cards themselves plus
  file-based handoffs — all recorded in git. This is a blackboard / stigmergic
  model: the work record *is* the communication channel.
- **Recoverable and resumable.** Because state is preserved in git and agents
  run statelessly, the loop can be stopped and picked up at any point by any
  engineer on any machine. A crash is just a resume.
- **Semi-deterministic enforcement.** Agent reasoning is probabilistic, but the
  gates around it are not. Validation at card creation and completion, the
  reviewer pass, and the closeout check are deterministic and unconditional — a
  card cannot be marked done while its hard requirements are unmet.

---

## Phase 1 — Plan: shape the work (human-orchestrated)

This is the most important phase to get right, and the one where you and your
team should spend your attention. The downstream harness will faithfully build
whatever the planning documents describe, so **the primary failure mode of the
whole system is getting the requirements wrong.** A confident harness building
the wrong thing is worse than no harness at all. Slow down here.

Planning produces three kinds of document, each written and then adversarially
reviewed by a paired set of skills. You drive the loop: the writer drafts, the
reviewer stress-tests, and you decide when it is ready.

| Question answered | Writer | Reviewer | Output |
|---|---|---|---|
| **What** to build and **why it matters** | `prd-writer` | `prd-reviewer` | a PRD in `docs/prds/` |
| **What** was decided architecturally and **why** | `adr-writer` | `adr-reviewer` | an ADR in `docs/adr/` |
| **How** to build it, in implementable detail | `design-doc-writer` | `design-doc-reviewer` | a design doc in `docs/designs/` |

```
  you ──► prd-writer ──────► prd-reviewer ────────► you (accept / revise)
            │
            ▼
  you ──► adr-writer ──────► adr-reviewer ────────► you (accept / revise)
            │
            ▼
  you ──► design-doc-writer ─► design-doc-reviewer ─► you (accept / revise)
```

The phases are skippable when the work doesn't warrant them — a contained bug
fix may go straight to a design doc or even a single card; a large initiative
earns the full PRD → ADR → design-doc chain. The writer and reviewer are
deliberately **separate** skills: an author reviewing their own work rubber-stamps
it, so the reviewer always comes at the artifact cold and tries to break it.

The output of this phase is a backlog of well-defined intent — documents
committed to the repo and linked to the roadmap node they serve.

---

## Phase 2 — Decompose: documents into cards (human-orchestrated)

Once the intent is settled, it is digested into a sequence of **gitban cards** —
the disposable agents of the execution phase. Cards are shaped in agile terms
(card, sprint, spike, closeout) and are created in sprints by a paired set of
skills:

- `sprint-architect` reads the planning artifacts and the roadmap target and
  decomposes them into sequenced, right-sized cards.
- `sprint-reviewer` adversarially reviews the sprint *before* dispatch —
  checking card quality, fragmentation, dependencies, and sequencing.

For a single piece of work that doesn't need a whole sprint, `sprint-architect`
can produce one standalone card.

What makes a card powerful is what gets **baked in** at creation time. Each card
carries everything the executing agent needs so it never has to guess:

- the **code context** and policies relevant to the change,
- the **implementation plan**,
- a **bespoke testing strategy** for that specific change, and — most
  importantly —
- the **enforceable definition of done**: hard, checkable requirements
  (acceptance criteria, test/coverage checkboxes, infrastructure-as-code
  requirements, a capstone). The validation engine enforces these structurally,
  so a card cannot be completed while a non-deferred requirement is unchecked.

Finished sprints land in the **backlog**. Because cards are plain files under
`.gitban/cards/`, they can be committed and reviewed in a normal git pull
request *before* a single line of implementation is written — you can vet the
plan the harness is about to execute.

---

## Phase 3 — Execute: the dispatch loop (autonomous)

This is the part that actually writes code, and it runs largely without you.
The `dispatcher` skill runs in your main session and orchestrates a sequence of
bespoke, stateless agents — the **dispatch loop** — that digest each card's
context at runtime in a sequence of fresh, isolated environments.

```
                  ┌──────────────┐
                  │  dispatcher  │  reads the sprint, sequences cards,
                  └──────┬───────┘  dispatches agents in phased batches
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
        ┌──────────┐┌──────────┐┌──────────┐
        │ executor ││ executor ││ executor │  parallel, isolated git worktrees
        │ read_card││ read_card││ read_card│  ← digests card context at runtime
        │  (code)  ││  (code)  ││  (code)  │  ← writes code + tests, commits
        │ complete ││ complete ││ complete │  ← gated by the definition of done
        └────┬─────┘└────┬─────┘└────┬─────┘
             ▼           ▼           ▼
        ┌──────────┐┌──────────┐┌──────────┐
        │ reviewer ││ reviewer ││ reviewer │  audits the work against the card
        └────┬─────┘└────┬─────┘└────┬─────┘  and the architecture docs
             ▼           ▼           ▼
        ┌──────────┐┌──────────┐┌──────────┐
        │  router  ││  router  ││  router  │  approve · send back · escalate
        └────┬─────┘└────┬─────┘└────┬─────┘
             ▼           ▼           ▼
        ┌─────────────────────────────────┐
        │             planner             │  captures follow-up work as cards;
        └─────────────────────────────────┘  self-heals the sprint
```

- **executor** — a senior-developer agent. Reads its card, works in an isolated
  git worktree, implements the change test-first, and marks the card done only
  when the hard requirements are met.
- **reviewer** — audits the executor's output against the card's definition of
  done and the project's architecture, looking for tech debt, coupling, and
  spec gaps.
- **router** — reads the review and decides what happens next: approve, send
  back for rework, or escalate.
- **planner** — captures any tech debt or follow-up the reviewer surfaced and
  routes it (a new backlog card, a new sprint card, or an append to the sprint's
  closeout tracker) so nothing is silently dropped. This is what makes the loop
  *self-healing*: problems become tracked work rather than lost context.

Each agent is stateless and writes its results to git-backed shared state, so
the loop is crash-safe: stop it, hand the repo to a colleague, and it resumes
from where the recorded state left off. No context survives in an agent between
cards — which is exactly why context never rots.

---

## Phase 4 — Land: closeout and PR (human-triggered)

When every card in a sprint is complete and its **capstones** (the
integration-level proofs that the composed work actually functions) are
satisfied, the sprint is closed out. A closeout review is the final gate: it
confirms objectives were genuinely achieved end-to-end, that deferred work was
rightfully deferred, and that card scope wasn't quietly diluted during
execution.

Then you invoke the `pr` skill to write a well-structured pull request from the
completed branch. The PR can be merged immediately or left open for human code
review — that choice stays with you. The pr agent comes to the branch with fresh
context and writes the PR from the work and the planning docs, not from a
memory of having done it.

---

## Single cards

The full sprint machinery is optional. A single card can be run through the same
dispatch loop on its own — `sprint-architect` shapes one card, and `dispatcher`
runs it through executor → reviewer → router just like a sprint of one. Use this
for contained changes that don't justify a whole sprint.

---

## Skills by phase (quick reference)

| Phase | Skills | Driven by |
|---|---|---|
| **Plan** | `prd-writer` · `prd-reviewer` · `adr-writer` · `adr-reviewer` · `design-doc-writer` · `design-doc-reviewer` | You (writer↔reviewer loop) |
| **Decompose** | `sprint-architect` · `sprint-reviewer` · `sprintmaster` | You |
| **Execute** | `dispatcher` · `executor` · `reviewer` · `router` · `planner` | Autonomous (you start the dispatcher) |
| **Land** | `sprint-closeout-reviewer` · `pr` | You |
| **Anytime** | `roadmap-navigator` | You |

The writer/reviewer and architect/reviewer skills are **human-orchestrated** —
you invoke each one and decide when its output is good enough. Only the dispatch
loop runs on its own, and even it is something you start and can stop at will.

## Where artifacts live

| Artifact | Location |
|---|---|
| Roadmap | `.gitban/roadmap/` |
| Cards (backlog, todo, in-progress, done, archive) | `.gitban/cards/` |
| PRDs | `docs/prds/` |
| Architecture Decision Records | `docs/adr/` |
| Design docs | `docs/designs/` |

All card and roadmap state is managed through gitban's MCP tools — never edit
those files by hand. The planning documents in `docs/` are ordinary files you
author through the writer skills and review like any other code.
