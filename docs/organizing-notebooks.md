---
title: Organizing Notebooks into projects
description: Best practices for organizing Deepnote notebooks into well-structured projects, whether working locally or on deepnote.com.
noIndex: false
noContent: false
---

# Organizing Notebooks into projects

Learn how to effectively organize your Deepnote notebooks into well-structured projects. These patterns work both when developing locally with `.deepnote` files and when using [deepnote.com](https://deepnote.com).

## Understanding Deepnote projects

### What is a Deepnote project?

A Deepnote project contains:

- **Multiple notebooks** - Related analysis notebooks organized together
- **Shared settings** - Python version, dependencies, and environment configuration
- **Integrations** - Database and service connections available to all notebooks
- **Project-wide resources** - Files, data, and configurations shared across notebooks

> **Key Concept:** Unlike Jupyter where each notebook is a separate `.ipynb` file, Deepnote organizes multiple related notebooks into a single project for better structure and collaboration.

## Organization patterns

### 📊 Data processing pipeline

**Use case:** Sequential data processing with clear stages

**Structure:**

- `01 - Extract Data` - Load data from sources
- `02 - Transform Data` - Clean and transform
- `03 - Load Data` - Load to warehouse
- `04 - Validate` - Quality checks

**Benefits:** Clear execution order, easy to understand flow, simple to maintain, good for automation

### 🧩 Modular analysis

**Use case:** Complex analysis with reusable components

**Structure:**

- `Utils - Data Loading` (shared module)
- `Utils - Preprocessing` (shared module)
- `Exploratory Analysis`
- `Segmentation Model`
- `Visualization`

**Benefits:** Code reuse across notebooks, easier maintenance, clearer separation of concerns

### 🔀 Multiple related analyses

**Use case:** Different analyses on the same dataset

**Structure:**

- `Data Preparation` (shared)
- `Customer Behavior`
- `Product Performance`
- `Revenue Analysis`
- `Marketing Attribution`
- `Executive Dashboard`

**Benefits:** Parallel development, feature isolation, easy navigation, better team collaboration

### 🧪 Machine learning experiments

**Use case:** Tracking and comparing multiple ML experiments

**Structure:**

- `Data Preparation`
- `Feature Engineering`
- `Experiment 01 - Baseline`
- `Experiment 02 - Random Forest`
- `Experiment 03 - XGBoost`
- `Experiment 04 - Neural Network`
- `Model Comparison`
- `Final Model`

**Benefits:** Track experiments, compare results, reproducible workflows, version controlled

## Best practices

### Naming conventions

- **Use prefixes for ordering** - `01 - Setup`, `02 - Analysis`, etc.
- **Be descriptive** - `Customer Segmentation Analysis` not `Analysis`
- **Group related notebooks** - Use consistent prefixes like `Utils -`, `Experiment -`
- **Indicate purpose** - `(Draft)`, `(Archive)`, `(Production)` as suffixes

### Project organization tips

#### Keep it focused

- One project = one cohesive goal or topic
- Split large projects into multiple smaller ones
- Archive old experiments and prototypes

#### Leverage shared resources

- Define dependencies once in project settings
- Configure database integrations at the project level
- Share utility notebooks across analyses

#### Document your structure

- Create a `README` notebook explaining the project
- Add markdown blocks describing each notebook's purpose
- Include setup instructions and dependencies

#### Version control friendly

- Commit `.deepnote` files to git
- Use meaningful commit messages
- Review changes before committing

### Working locally vs. deepnote.com

Both environments support the same organizational patterns:

**Local development** (`.deepnote` files)

- Full control over project structure
- Edit with VS Code, Cursor, or Windsurf
- Version control with git
- Execute code with local Python kernel

**Deepnote Cloud** ([deepnote.com](https://deepnote.com))

- Real-time collaboration
- Managed compute and environment
- Built-in version history
- One-click sharing and deployment

You can seamlessly move projects between local and cloud by uploading/downloading `.deepnote` files.

## Getting started

To create a well-organized project:

1. **Start with a clear goal** - What problem are you solving?
2. **Choose an organization pattern** - Pipeline, modular, experiments, etc.
3. **Create your notebooks** - Add notebooks following your chosen structure
4. **Configure project settings** - Set up dependencies and integrations
5. **Add documentation** - Create a README notebook with project overview

For more details on the `.deepnote` file format, see the [Deepnote format documentation](/docs/deepnote-format).
