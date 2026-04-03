# Claude Development Guide

This document provides guidelines for Claude (AI assistant) when working on the Deepnote monorepo.

## Repository Overview

This is a TypeScript monorepo for Deepnote's open-source packages, managed with pnpm workspaces. The repository contains:

- **packages/blocks** - Core package for working with Deepnote blocks and notebook files
- **packages/convert** - Bidirectional converter between Jupyter Notebook files (`.ipynb`) and Deepnote project files (`.deepnote`)
- **packages/database-integrations** - Database integration definitions, schemas, and authentication methods
- **packages/reactivity** - Reactivity and dependency graph for Deepnote notebooks

## Development Workflow

### Running Commands

Always run commands from the **root directory** unless specifically told otherwise.

#### Testing

```bash
# Run all tests
pnpm test

# Run tests with coverage
pnpm test:coverage
```

#### Type Checking

```bash
# Type check all packages
pnpm typecheck
```

#### Linting & Formatting

```bash
# Check for linting and formatting issues
pnpm biome:check

# Auto-fix linting and formatting issues
pnpm biome:check:fix

# Check prettier formatting for markdown/yaml
pnpm prettier:check

# Auto-fix prettier formatting
pnpm prettier

# Run both biome and prettier checks
pnpm lintAndFormat

# Auto-fix both
pnpm lintAndFormat:fix
```

#### Building

```bash
# Build all packages
pnpm build
```

### Code Quality Standards

#### Before Committing

Always run these checks before considering work complete:

1. **Tests** - `pnpm test` - All tests must pass
2. **Type Check** - `pnpm typecheck` - No TypeScript errors
3. **Linting** - `pnpm biome:check` - Code must pass Biome linter

#### Testing Guidelines

- Create comprehensive tests for all new features
- Place test files next to the source files with `.test.ts` or `.test.tsx` extension
- Use Vitest as the testing framework
- Follow existing test patterns in the codebase (see `packages/blocks/src/blocks/*.test.ts`)
- Test edge cases, error handling, and special characters
- For functions that generate code, test the exact output format

#### TypeScript Guidelines

- Use strict type checking
- Prefer type safety over convenience
- Use `const` for immutable values
- Avoid `any` types - use proper type definitions

#### Linting Guidelines

- Follow Biome's rules (configured in `biome.json`)
- Use literal keys instead of bracket notation when possible
- Prefer single quotes for strings (except when avoiding escapes)
- Keep code clean and readable

## Package-Specific Information

### @deepnote/blocks

**Location:** `packages/blocks/`

**Purpose:** Core package for working with Deepnote blocks, converting between Deepnote and Jupyter formats, and generating Python code from block configurations.

**Key modules:**

- `src/blocks/` - Block type definitions and code generation
  - `code-blocks.ts` - Code block handling
  - `sql-blocks.ts` - SQL block handling
  - `data-frame.ts` - DataFrame configuration for table display
  - `input-blocks.ts` - Input widgets (text, checkbox, select, etc.)
  - `python-utils.ts` - Python string escaping utilities
- `src/deserialize-file/` - .deepnote file parsing
- `src/python-code.ts` - Main entry point for Python code generation

**Common patterns:**

- Use `escapePythonString()` for safely embedding strings in Python code
- Use `ts-dedent` for clean multiline template strings
- Block metadata contains configuration like `deepnote_table_state`, `deepnote_variable_name`, etc.
- Always include DataFrame config when generating code for code/SQL blocks

## Common Tasks

### Adding Tests for New Features

1. Create a `.test.ts` file next to the source file
2. Import test utilities from vitest: `import { describe, expect, it } from 'vitest'`
3. Group related tests with `describe()` blocks
4. Write clear test names that describe the expected behavior
5. Use `dedent` from `ts-dedent` for multiline string comparisons
6. Run tests to verify: `pnpm test`

### Fixing Linting Issues

1. Run `pnpm biome:check` to see issues
2. Many issues can be auto-fixed with `pnpm biome:check:fix`
3. For remaining issues, manually address them following the linter's suggestions
4. Common fixes:
   - Replace bracket notation with dot notation: `obj['prop']` → `obj.prop`
   - Use consistent quotes: prefer single quotes
   - Remove unused imports/variables

### Fixing Type Errors

1. Run `pnpm typecheck` to see all type errors
2. Fix type errors by:
   - Adding proper type annotations
   - Using type guards for conditional access
   - Ensuring function signatures match implementations
   - Properly typing object properties

## File Structure Conventions

- Source code: `packages/*/src/`
- Tests: Co-located with source as `*.test.ts`
- Test fixtures: `test-fixtures/` (shared across all packages)
- Types: Define inline or in separate `types.ts` files
- Build output: `packages/*/dist/` (gitignored)

### Test Fixtures

Always place test fixtures in the shared `test-fixtures/` directory at the repository root, not in package-specific `__fixtures__` directories. This allows fixtures to be reused across packages.

To reference fixtures from a test file:

```typescript
import path from "node:path";

const testFixturesDir = path.join(__dirname, "../../../test-fixtures");
const fixturePath = path.join(testFixturesDir, "my-fixture.ipynb");
```

## Keeping the Deepnote Skill in Sync

The `skills/deepnote/` directory contains reference documentation used by AI agents. When making changes to any of the following, you **must** also update the corresponding skill files:

- **`.deepnote` file format** (block types, metadata, schema) — update `skills/deepnote/references/blocks-*.md` and `skills/deepnote/references/schema.ts`
- **CLI commands** (options, output formats, exit codes, new commands) — update `skills/deepnote/references/cli-*.md`
- **MCP tools** (tool names, parameters, behavior) — update `skills/deepnote/references/cli-*.md` (MCP mirrors CLI commands)

## Important Notes

- **Never commit without running tests, typecheck, and linting**
- **Always preserve existing functionality** - check that changes don't break other tests
- **Follow existing code patterns** - look at similar code in the repo for guidance
- **Use pnpm, not npm or yarn** - this is enforced by packageManager field
- **Read error messages carefully** - they often contain the solution
- **When updating code generation**, update corresponding tests to match new output format

## Tools & Technologies

- **Package Manager:** pnpm 10.18.1+
- **Node Version:** 22.14.0+
- **Build Tool:** tsdown
- **Test Framework:** Vitest
- **Linter:** Biome
- **Formatter:** Biome + Prettier (for md/yaml)
- **Type Checker:** TypeScript 5.9.3

## Getting Help

- Check existing tests for examples
- Read error messages - they're usually helpful
- Look at similar code in the repository
- Review CONTRIBUTING.md for contribution guidelines
