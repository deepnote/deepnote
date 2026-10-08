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

Findings
  ⚠ egress-external: 5 in 2 projects
  ⚠ credential-hardcoded: 2 in 2 projects
  ✖ credential-shared: 2 in 2 projects
  ⚠ ingress-integration-orphan: 1 in 1 project
  ⚠ ingress-integration-undeclared: 1 in 1 project
  ⚠ pii-subject-scatter: 1 in 1 project
  ✖ sql-null-comparison: 1 in 1 project
  ⚠ sql-string-boolean: 1 in 1 project

Summary: 3 errors, 11 warnings
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

Plus every project-scoped check: `sql-null-comparison`, `sql-tautology`, `sql-string-boolean`, and
`credential-hardcoded`. See the [CLI overview](/docs/deepnote-cli) for the lint command.

## Options

| Option                  | Description                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `[dir]`                 | Directory of synced `.deepnote` files (default: `.`)                                |
| `-o, --output <format>` | `json` for the full report, including the flow map; `llm` resolves to the same JSON |
| `--project <name>`      | Audit a single project, by name or id                                               |
| `--issues`              | List every finding instead of a count per check                                     |
| `--internal-domain <d>` | A domain belonging to your organization (repeatable)                                |

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
- **Consensus checks are not run.** Finding the same metric defined two different ways needs a
  workspace large enough for agreement to mean something — roughly 100 projects, as an order of
  magnitude rather than a measured threshold. Below that, a ranking of "divergent" definitions is
  noise presented as signal.

## What leaves the process

Everything the audit prints passes through one redaction step, applied to the assembled report as
a whole rather than to each section as it is built. Credentials are masked in place wherever they
appear — in a finding, a project or notebook name, an integration name, a flow-map label, a parse
error — so a section added to the report later inherits the masking without anyone remembering to
wire it up.

This is why names in the output may be partly masked: a project called after a connection string
is reported with the password replaced and the rest of the name intact, which keeps the finding
locatable without reproducing the secret.

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
