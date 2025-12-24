# @deepnote/reactivity

Reactivity and dependency graph for Deepnote notebooks.

## Overview

This package provides utilities for analyzing dependencies between Deepnote blocks to build a reactivity graph. It uses a Python-based AST analyzer to identify defined and used variables in various block types.

- **AST Analysis**: Extracts variable definitions and usages from Python and SQL blocks.
- **Dependency Tracking**: Identifies how blocks depend on each other through variables.
- **Reactivity Support**: Powers the reactive execution model by analyzing block content.
