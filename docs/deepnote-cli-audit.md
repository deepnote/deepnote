---
title: Auditing a workspace with the Deepnote CLI
description: Inventory your integrations, map where notebook data flows, and find governance issues across a whole synced workspace with deepnote audit
noIndex: false
noContent: false
---

`deepnote audit` reads a workspace you have mirrored locally with
[`deepnote sync`](/docs/deepnote-cli-sync) and answers three questions that no single project can:
what do I have, where does my data go, and what is wrong across all of it.

```bash
deepnote sync ./workspace
deepnote audit ./workspace
```

Everything is computed on your machine from the `.deepnote` files. The audit opens no warehouse
connections, runs no Python, and sends nothing anywhere.

## What it reports

```
Workspace ./workspace
  4 projects, 4 notebooks, 9 blocks (4 SQL, 5 code)

Ingress — integrations
  Warehouse (snowflake) — 3 projects, 3 SQL blocks
  cccccccc-3333-4333-8333-cccccccccccc — 1 project, 1 SQL block · undeclared in 1
  ⚠ Legacy Redshift (redshift) — declared in 1 project, used by none

Tables — ranked by live reach
  campaigns — 1 project, 1 SQL block
  forecasts — 1 project, 1 SQL block
  orders — 1 project, 1 SQL block
  tickets — 1 project, 1 SQL block
  users — 1 project, 1 SQL block

Consensus — divergence
  No anchor is defined two ways, or the corpus is too small to tell.

Egress — external hosts
  → writes  api.segment.io — 2 projects, 2 blocks
  → writes  hooks.slack.com — 1 project, 1 block
  → writes  s3://finance-exports — 1 project, 1 block
  → writes  s3://marketing-exports — 1 project, 1 block
  ← reads   gs://raw-events — 1 project, 1 block

Data subjects
  2 people in 5 locations, unclassified — pass --internal-domain to separate colleagues from customers
  ⚠ 1 person appears in more than one notebook
  Identities are fingerprinted per run and discarded. For a persistent, searchable
  index, run "deepnote subjects index".

Credentials shared across projects
  ✖ 2d24bb7a7685f122 (Credential assigned to a secret-named variable) — 2 projects: Marketing campaigns, Revenue reporting

Maintenance
  3 live, 0 aging, 1 cold (3y+) notebooks · median age 29 days

Findings
   60 ✖ credential-shared: 2 in 2 projects
   49 ⚠ egress-external: 5 in 2 projects
   38 ⚠ pii-subject-scatter: 1 in 1 project
   26 ⚠ credential-hardcoded: 2 in 2 projects
   14 ✖ sql-null-comparison: 1 in 1 project
   10 ⚠ ingress-integration-orphan: 1 in 1 project
    8 ⚠ ingress-integration-undeclared: 1 in 1 project
    8 ⚠ sql-string-boolean: 1 in 1 project
    1 ⚠ asset-stale: 1 in 1 project

Summary: 3 errors, 12 warnings
```

### Ingress — your integrations

Every native integration any project declares or queries, with the projects that use it and how
many SQL blocks each runs. An integration **declared by a project and used by no block anywhere** is
called out: nobody is reading from it, but its credentials are still live and still rotatable.

### Egress — where data goes

Third-party hosts your code reaches, recovered from the URLs written into code blocks. Hosts the
code **writes** to are listed first and reported as findings; reads are inventoried but not flagged.
Object-store buckets count as their own destination, so `s3://marketing-exports` and
`s3://finance-exports` are two different places, not one provider.

### Tables — what depends on what

Every table the workspace's SQL references, ranked by how many **live** projects query it. Where the
live count differs from the raw one, both are shown — `users — 12 live of 100 projects` —
because the raw one is the number people quote and the live one is the number that is true. A table
referenced by 100 projects of which only 12 were edited in the past year is not an eight-times
bigger dependency than one with 12 live readers; it is the same dependency with a lot of abandoned
notebooks attached. Where every reader is live the counts collapse to one number, as in the small
sample above.

Common table expressions are not counted — a CTE is local to its query, and treating one as a table
would invent a dependency between two notebooks that happen to use the same name for a scratch
result.

<<<<<<< HEAD
**What counts as the same table.** A table is identified by its short name within one integration,
so `FROM analytics.users` and `FROM users` against the same warehouse are one row with one reach
count — the same identity the divergence anchors use, rather than a second answer to the same
question. A `users` behind two different integrations stays two rows, because it is two tables; so
does a `users` in a block that declares no integration, which goes in an `unknown` bucket of its
own. Every qualified spelling seen is listed in `qualifiedNames`, so the one case this still
conflates — `analytics.users` and `staging.users` behind a _single_ integration — is visible on
the row rather than silent. Telling those apart would mean knowing which schema an unqualified
`users` resolved to, which is a property of the warehouse's search path and not of the query.
=======
### Consensus — where definitions disagree

The one question that only exists across a whole workspace: is the same thing defined two different
ways in two different notebooks? `= NULL` is wrong on its own; a table pair joined on different keys
is only wrong _relative to_ what every other query does.

The audit anchors consensus on three things that mean the same thing in every notebook:

| Anchor     | The subject          | Variants are                 | Example divergence                                      |
| ---------- | -------------------- | ---------------------------- | ------------------------------------------------------- |
| **join**   | a pair of tables     | the join keys                | `orders.user_id = users.id` vs `orders.email = u.email` |
| **filter** | a table and a column | whether the query filters it | six queries filter `orders.is_test`, two do not         |
| **metric** | an output name       | the aggregate behind it      | `revenue` as `sum(amount)` vs `sum(amount_gross)`       |

Spelling is normalized before anything is compared, which is what makes this work across projects at
all. These three are one claim, not three:

```sql
FROM orders o JOIN users u ON o.user_id = u.id
FROM users JOIN orders ON users.id = orders.user_id
FROM analytics.public.orders AS a, prod.users AS b WHERE b.id = a.user_id
```

Aliases are resolved to table names, operand order is sorted, composite conditions are gathered into
one claim per table pair, and a table is identified by its short name — so `analytics.users` and
`staging.users` are one subject, with the conflation that implies.

#### One warehouse at a time

Anchors are scoped by integration. A table called `users` behind one connection and a table called
`users` behind another are not the same table, and comparing them manufactures a disagreement
between systems that never shared a schema. `--divergence-scope type` relaxes this to the
integration _type_, which is right when several projects each hold their own connection to the same
warehouse; `none` pools everything, and exists so the cost of the scoping is measurable.

A block with no `sql_integration_id` goes in its own bucket and is never compared against a known
warehouse. The report says how many blocks that was.

Scoping also makes dialect folding safe: within one integration type, `nvl`, `ifnull` and
`coalesce` are the same intent written three ways, and reporting that as a disagreement is noise.

#### Confidence, not thresholds

Every group carries a **Wilson lower bound** on its consensus share: the share a population could
plausibly have, given a sample this size, taken at the pessimistic end. It replaces the arbitrary
"ignore anchors with fewer than N observations" rule by discounting thin evidence instead of
discarding it.

| Consensus | Wilson | Reading               |
| --------- | ------ | --------------------- |
| 2 of 3    | 0.21   | a coincidence         |
| 3 of 4    | 0.30   | still thin            |
| 20 of 30  | 0.49   | probably a convention |
| 78 of 80  | 0.91   | a convention          |

Groups above `--min-confidence` (0.25 by default) raise a `sql-divergence` finding per diverging
block. Groups below it are still reported — they are exactly the ones somebody has to look at before
this check's precision is anything more than an assertion.

```bash
# Every group, every variant, every location
deepnote audit workspace --divergence

# Only joins, and only where the consensus is well attested
deepnote audit workspace --divergence --divergence-kind join --min-confidence 0.5
```

### Measuring precision instead of asserting it

The per-kind weights behind the ranking are unmeasured starting points. They encode one structural
claim — a table pair means exactly one thing, so two queries relating it differently cannot both be
right, whereas two teams may legitimately mean different things by `revenue` — and nothing more.

They are meant to be replaced by a measurement, which is a two-command job:

```bash
deepnote audit workspace --divergence --export-review review.json
# fill in "verdict" on each entry: real, legitimate-difference, or false-positive
deepnote audit workspace --import-review review.json
```

The export carries every group, every variant and the locations to look at, ordered best-attested
first so a partly filled file still measures the part that matters most. On import the audit reports
precision per kind and uses it in place of the default once at least 10 entries of that kind are
judged — below that the measurement is noisier than the guess it would replace, so it is reported
and not used. `details.signalSource` on every finding reads `prior`, `measured` or `triage`, so a
reader can always tell which number produced the score.

### Triage: asking a model the question the arithmetic cannot

Confidence measures how lopsided a split is. It cannot measure whether the two forms were ever
supposed to agree, and that is what decides whether a finding is worth your time. A lexer cannot
see a name collision, `x` against `t.x`, `count(1)` against `count(*)`, or a table pair joined two
ways because the two joins answer different questions.

Normalizing harder is deliberately **not** the fix: stripping table qualifiers would collapse a
genuine finding — a table rename that only half the workspace followed. So the judgement goes to a
model, and the model is optional:

```bash
export DEEPNOTE_TRIAGE_BASE_URL=http://localhost:11434/v1   # Ollama, LM Studio, vLLM…
export DEEPNOTE_TRIAGE_MODEL=qwen2.5-coder:7b
deepnote audit workspace --triage
```

- **Off by default.** Without `--triage` the report is byte-identical to one that never heard of it.
- **No default endpoint.** `--triage` without a configured URL is an error, not a call to somebody's
  cloud. The resolved endpoint is printed before the first request.
- **The model never sees your blocks.** It gets pre-grouped variant forms, redacted the same way the
  rest of the report is, and the payload is bounded by finding count rather than workspace size.
- **Verdicts are cached** under `.deepnote/` and keyed by model, so CI is free and offline on a hit.
- **Both numbers are kept.** A verdict replaces the default in `signal`, and `details` carries the
  verdict, its reason and the number it displaced.
- **`false-positive` leaves the ranking but stays in the report**, under `suppressed`, with its
  reason printed. Suppression you cannot read is indistinguishable from a check that stopped working.
- **It can never fail the run.** Any error, timeout or malformed verdict warns once and the
  deterministic score stands.

If you have both a review file and a triage run, the audit reports how often the model agreed with
the reviewer, per kind. Without that number, a model's opinion is one unmeasured judgement
replacing another.

**Divergence precision is unvalidated.** Joins are the strongest anchor and metrics the weakest — a
table pair means exactly one thing, while two teams may legitimately mean different things by
`revenue`. That ordering is built into the ranking as a per-kind prior, reported in the JSON
alongside the confidence so you can disagree with it without re-running the audit. Use
`--skip-divergence` to leave the consensus checks out entirely.
>>>>>>> 6b72017 (feat(cli): find SQL divergence across a workspace, ranked by Wilson confidence)

### Maintenance

How many notebooks are live (edited or run within a year), aging, cold (three years or more), or
carry no date at all — plus the median age. A notebook with no `modifiedAt` is reported as
**undated**, never as abandoned: an export that happens not to carry a timestamp is an absence of
evidence, and filing it as neglect would fill the ranking with findings about files nobody can date.

A block's recorded execution counts as a touch, so a notebook that ran last week is live even if
nobody edited the file.

### Data subjects

How many people the workspace holds data about, and how many of them are spread across more than one
notebook. Identities are fingerprinted under a salt generated for the run and discarded with it, so
the report cannot be read back as a list of people — and cannot be compared against another report.
For a persistent, searchable index, use
[`deepnote subjects index`](/docs/deepnote-cli-subjects).

Pass `--internal-domain` to separate colleagues from customers; without it, everyone is counted
alike and the report says so.

### Credentials

A credential hardcoded in more than one project is reported by fingerprint — a truncated SHA-256,
never the value itself. The fingerprint is what tells you that rotating one key will break four
notebooks in three projects at once.

### Findings

Alongside the workspace-level checks, every project is run through the same checks as
`deepnote lint --governance`, so one audit covers both scopes.

| Code                             | Finding                                                              |
| -------------------------------- | -------------------------------------------------------------------- |
| `ingress-integration-orphan`     | An integration is declared but no SQL block uses it                  |
| `ingress-integration-undeclared` | A SQL block runs against an integration the project does not declare |
| `egress-external`                | A code block writes to a host outside Deepnote and your integrations |
| `credential-shared`              | The same credential is hardcoded in more than one project            |
| `pii-subject-scatter`            | One person's data appears in more than one notebook                  |
| `asset-stale`                    | A notebook untouched for three years or more                         |
| `sql-divergence`                 | A query defines a join, filter or metric differently from the rest   |

Plus every project-scoped check: `sql-null-comparison`, `sql-tautology`, `sql-string-boolean`, and
`credential-hardcoded`. See the [CLI overview](/docs/deepnote-cli) for the lint command.

## Options

| Option                   | Description                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `[dir]`                  | Directory of synced `.deepnote` files (default: `.`)                                |
| `-o, --output <format>`  | `json` for the full report, including the flow map; `llm` resolves to the same JSON |
| `--project <name>`       | Audit a single project, by name or id                                               |
| `--issues`               | List every finding instead of a count per check                                     |
| `--internal-domain <d>`  | A domain belonging to your organization (repeatable)                                |
| `--divergence`           | List every consensus group with its variants and locations                          |
| `--divergence-kind <k>`  | Limit consensus to `join`, `filter` or `metric` (repeatable)                        |
| `--min-confidence <n>`   | Consensus confidence below which a group raises no finding (default `0.25`)         |
| `--skip-divergence`      | Do not run the consensus checks at all                                              |
| `--divergence-scope <s>` | Which queries may be compared: `integration` (default), `type`, or `none`           |
| `--triage`               | Ask a model whether each group is a real defect (needs a configured endpoint)       |
| `--triage-base-url <u>`  | OpenAI-compatible endpoint (or `DEEPNOTE_TRIAGE_BASE_URL`)                          |
| `--triage-model <name>`  | Model to triage with (or `DEEPNOTE_TRIAGE_MODEL`)                                   |
| `--triage-limit <n>`     | Triage only the n most confident groups                                             |
| `--no-triage-cache`      | Ignore cached verdicts and ask again                                                |
| `--export-review <f>`    | Write every group to `<f>` with a blank verdict, for review                         |
| `--import-review <f>`    | Read verdicts back and use measured precision instead of the defaults               |

## How findings are ranked

```
severity = signal × exposure × neglect × blast radius
```

Each factor is measured from a different thing, and `-o json` reports all four alongside the score,
so you can disagree with one of them rather than with the number.

| Factor           | What it measures                                                                      |
| ---------------- | ------------------------------------------------------------------------------------- |
| **signal**       | How often the check is right when it fires — precision, not importance                |
| **exposure**     | How far the consequence reaches beyond the block it sits in                           |
| **neglect**      | How long the asset has gone untouched. Never below 1, so it only ever raises severity |
| **blast radius** | How much **live** work depends on the thing, saturating rather than scaling linearly  |

Two consequences worth knowing about:

- **A wrong query is ranked by what reads its tables.** The same `= NULL` predicate scores higher in
  a notebook querying a table three live projects depend on than in one querying a table nobody
  reads.
- **A credential in an abandoned notebook ranks _above_ one in a live notebook.** The key still
  works, nobody is watching the notebook that would have caught it, and exposure findings are
  floored so liveness weighting cannot score them as harmless. Neglect raises severity; it never
  lowers it. The discount for "nobody uses this" belongs to blast radius, which is measured
  separately.

Nothing is gated on the score. A low-ranked finding is further down the list, never absent from it.

`signal` and `exposure` are currently judgment calls written as explicit constants, not measured
precision — deliberately explicit so they can be argued with, and replaced once someone has clicked
through a ranked sample.

## The flow map

`-o json` includes a `flow` object: `nodes` for every integration, project and external host, and
`edges` for every connection between them. It is emitted as data rather than a drawing so the same
report can back the terminal summary, a dashboard, or a diagram you generate yourself.

```bash
deepnote audit ./workspace -o json | jq '.flow.edges[] | select(.kind == "writes")'
```

Projects with no tracked flows are still included as nodes. A project connected to nothing is an
answer to "what do I have", not a gap in the report.

## What the audit cannot see

The audit reports its own blind spots on every run, because an audit that hides them reads as a
clean bill of health:

- **Egress is a lower bound.** It sees hosts written into block content. A URL assembled from
  variables at run time is invisible, and a URL whose host is only partly literal —
  `f"https://api.{env}.example.com/x"` — is skipped rather than recorded as `api.{env`. A
  destination nobody can act on would be worse than a gap you know is there.
- **Integration usage counts SQL blocks in notebooks only.** dbt models, BI tools and other
  consumers of the same warehouse are not visible from a Deepnote workspace.
- **Consensus thins out on a small workspace.** Agreement needs a workspace large enough for
  agreement to mean something — roughly 100 projects, as an order of magnitude rather than a
  measured threshold. Below that the audit still runs the consensus checks, but says how far below
  the line it is, and the Wilson confidence on each group carries the discount rather than a
  blanket refusal.
- **Divergence precision is unvalidated.** The per-kind priors behind the ranking are judgment, not
  measurement. `--divergence` exists so they can be replaced with measured numbers.
- **Column-level checks need the warehouse catalogue.** Whether a query references a column that
  was dropped, or whether a PII column reaches an egress point, cannot be decided from the
  `.deepnote` files alone. The audit never connects to a warehouse.

## What leaves the process

Everything the audit prints passes through one redaction step, applied to the assembled report as
a whole rather than to each section as it is built. Credentials **and email addresses** are masked
in place wherever they appear — in a finding, a project or notebook name, an integration name, a
flow-map label, a file path, a parse error — so a section added to the report later inherits the
masking without anyone remembering to wire it up.

This is why names in the output may be partly masked: a notebook called
`Churn for dana@customer.example` is reported as `Churn for <redacted>`, which keeps the finding
locatable without naming the person it is about. A `pii-subject-scatter` finding withholds the
subject's fingerprint by design, and it would be pointless to do that while printing their address
in the field beside it.

`deepnote subjects index` is the deliberate exception. It is the one output whose purpose is to
say where a named person's data is, so its locations keep the real project, notebook and path. The
index is sensitive by design and should be handled as such — see
[`deepnote subjects`](./deepnote-cli-subjects.md).

## Audit is not a gate

`deepnote audit` exits `0` whenever it could read the workspace, however many findings it reports.
It is an inventory you run on a schedule or before a review, not a check that fails a pipeline.

For CI, use the project-scoped checks instead, which do fail on errors:

```bash
deepnote lint my-project.deepnote --governance || exit 1
```

**Exit codes:** `0` the workspace was audited, `1` the workspace could not be read, `2` invalid
usage (directory or project not found).

## Related

- [Syncing a workspace with the Deepnote CLI](/docs/deepnote-cli-sync) — produces the tree this
  command audits
- [Answering data subject requests with the Deepnote CLI](/docs/deepnote-cli-subjects) — the
  persistent, searchable version of the subject counts reported here
- [Deepnote CLI](/docs/deepnote-cli) — all commands, including `deepnote lint`
- [Deepnote file format](/docs/deepnote-format) — what is inside a `.deepnote` file
