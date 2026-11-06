---
title: Understanding notebook dependencies with the Deepnote CLI
description: See how the blocks of a Deepnote notebook depend on each other, find what to re-run after a change, run a block with only what it needs, and draw the dependency graph with deepnote dag and analyze
noIndex: false
noContent: false
---

Every block in a notebook reads some variables and defines others. The Deepnote CLI works out those
links from the code itself, so you can answer the questions that make long notebooks hard to work
with: _what does this block need?_, _what breaks if I change it?_ and _what do I actually have to
re-run?_

It is the same idea behind the **Block and dependent blocks** [execution mode](/docs/execution-modes)
in Deepnote, which runs a block together with the blocks below it that depend on it.

All commands work on local `.deepnote` files and need a Python 3 interpreter that can import
`jinja2` (`deepnote-toolkit` installs it); see
[Deepnote CLI](/docs/deepnote-cli) for installation.

## See the whole graph

```bash
deepnote dag show analysis.deepnote
```

```text
Dependency Graph (5 blocks, 3 edges)

├── import pandas as pd [code]
│   defines: orders
│   └─► by_country = orders.groupby("country").revenue.su… [code] via orders
│       defines: by_country
│       └─► total = by_country.sum() [code] via by_country
│           defines: total
│           └─► print(total) [code] via total
└── unrelated = 42 [code]
    defines: unrelated
```

Each arrow names the variable that connects two blocks. Blocks with nothing above them are entry
points; a block on its own, like `unrelated = 42` here, is a candidate for deleting or moving to its
own notebook.

To get a picture for a design review or documentation, render it with
[Graphviz](https://graphviz.org/):

```bash
deepnote dag show analysis.deepnote -o dot | dot -Tsvg -o dependencies.svg
```

## What each block reads and defines

```bash
deepnote dag vars analysis.deepnote
```

```text
by_country = orders.groupby("country").revenue.su… (code)
  Defines: by_country
  Uses: orders
```

Use it to find where a variable comes from, or which blocks still use a column or table you want to
rename.

## What to re-run after a change

```bash
deepnote dag downstream analysis.deepnote --block "by_country = orders.groupby(\"country\").revenue.su…"
```

```text
Downstream Impact for by_country = orders.groupby("country").revenue.su…

2 blocks will need to re-run:

  • total = by_country.sum() (code)
  • print(total) (code)
```

`--block` takes a block id or the block's label as shown by `dag show`. Before you change a block
that loads or cleans data, this tells you which charts, tables and exports downstream will change
with it. `-o json` returns the same list with block ids, for scripts and AI agents.

## Run a block with only what it needs

`deepnote run --block` runs a block together with the blocks it depends on.
Preview the plan with `--dry-run`:

```bash
deepnote run analysis.deepnote --block <block-id> --dry-run
```

```text
Execution Plan (dry run)
──────────────────────────────────────────────────
[1/3] import pandas as pd
[2/3] by_country = orders.groupby("country").revenue.su…
[3/3] total = by_country.sum()
──────────────────────────────────────────────────
Total: 3 block(s) would be executed
```

Blocks outside the target block and the blocks it depends on, directly or through another block,
are skipped. The analysis also links a block to the nearest
earlier block that uses one of the same variables, so a block that only reads `orders`, such as an
export, can still be part of the plan. In Deepnote Cloud, the
[API](/docs/deepnote-api-runs) can do the reverse: run selected blocks and everything that depends
on them with `runDependentBlocks`.

## A health check for the whole notebook

```bash
deepnote analyze analysis.deepnote
```

`analyze` combines the graph with [`deepnote lint`](/docs/deepnote-cli-git)
into one report: a quality score, the number of blocks and lines of code, entry and exit points, the
longest chain of dependent blocks, imported packages, and any issues such as unused variables. A long
chain or many disconnected blocks is a sign a notebook would be easier to work with split into
[several notebooks](/docs/organizing-notebooks).

## For AI agents

All of these commands accept `-o json` and `-o llm`, so a coding agent can check what a
change affects before making it and run only what it needs afterwards. `deepnote install-skills`
teaches agents such as Claude Code, Codex and Cursor to use them; see
[Deepnote CLI](/docs/deepnote-cli).

## Limitations

The analysis reads Python and SQL source without running it, so it cannot see dependencies created
at run time, for example variables set through `globals()`, `exec` or a `%run` of another file.
A name that is never defined in the notebook, such as `spark` provided by the environment, links the
blocks that use it, and the first of them is shown as defining it.

## Related

- [Deepnote CLI](/docs/deepnote-cli): every command
- [Execution modes](/docs/execution-modes): running dependent blocks in Deepnote
- [Working with notebooks in Git](/docs/deepnote-cli-git)
- [Organizing notebooks](/docs/organizing-notebooks)
