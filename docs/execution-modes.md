---
title: Execution modes
noIndex: false
noContent: false
---

<Embed url="https://www.loom.com/embed/e8f122e1ba4f47a19c7dfdb75f936edd?sid=922f1ba5-097d-4c5f-b563-0bf728136471"/>

Deepnote offers two modes of execution:

- **Block**: This runs only the selected block (or multiple blocks in the case of multi-selection).

- **Block and dependent blocks**. This runs the selected block and other blocks below it that depend on that block.

The default execution mode for a block in the notebook can be changed next to the "Run notebook" button.

<ImageBorder variant="blue">![Screenshot 2024-04-23 at 10.15.40.png](https://media.graphassets.com/VHvdkG1DT862UHkNdg9t)</ImageBorder>

The current execution mode is displayed within the "Run block" icon in the block actions. You can always override the default execution mode by selecting "Run this block only" or "Run dependent blocks" in the block actions.

<ImageBorder variant="colorful">![Screenshot 2024-04-19 at 12.52.41.png](https://media.graphassets.com/vRTSDtYbSoWZiZemv3R9)</ImageBorder>

## How are block dependencies detected?

In some cases, this process is straightforward; for example, a visualization block depending on a DataFrame, or a text input block defining Python variables used by other blocks.

However, with code blocks containing arbitrary user code, the problem becomes more complicated. These blocks can define new variables, reassign, or mutate them, potentially affecting other blocks.

### Directed Acyclic Graph (DAG)

Every code block, including code segments within SQL blocks using Jinja templates, is parsed into an Abstract Syntax Tree (AST). We traverse this AST to compile lists of variables used and defined by each block. By compiling these lists for every block in the notebook, along with their position in the notebook, we construct a Directed Acyclic Graph (DAG) of blocks.

When a block is executed, the DAG is traversed from the requested block downward. All blocks encountered during this traversal are executed.

You can view the DAG for a notebook anytime by clicking on the "Open dependency graph" button.
