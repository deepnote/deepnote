# Deepnote open-source monorepo

This pnpm monorepo contains Deepnote's open-source notebook format, TypeScript packages, CLI and MCP tools, and local runtime orchestration.

## Working rules

- Use the routing table before searching. Start with the owning package's README, manifest, tests, and nearest documentation; do not traverse unrelated packages.
- Read `package.json`, `pnpm-workspace.yaml`, and CI configuration for current commands, versions, and tooling instead of copying them into guidance.
- Add or update focused tests for behavior changes, then run the smallest relevant package checks before broader repository checks.
- Document non-obvious cross-package or cross-file coupling at each affected location with reciprocal references.
- Put durable discoveries in shared documentation or the Deepnote skill, not local memory files. Keep this file limited to behavior and routing.
- When changing the `.deepnote` format, CLI, or MCP behavior, update the corresponding material under `skills/deepnote/` in the same change.

## Routing table

| When looking for                                     | Look into                                                                                                                                 |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Product overview and package map                     | [README.md](README.md)                                                                                                                    |
| Contribution workflow and repository-wide validation | [CONTRIBUTING.md](CONTRIBUTING.md), `package.json`, and `.github/workflows/`                                                              |
| File format, block schemas, and code generation      | [packages/blocks/README.md](packages/blocks/README.md), `json-schemas/`, and [skills/deepnote/SKILL.md](skills/deepnote/SKILL.md)         |
| Conversion formats and behavior                      | [packages/convert/README.md](packages/convert/README.md) and its colocated tests                                                          |
| CLI or MCP commands and contracts                    | [packages/cli/README.md](packages/cli/README.md), [packages/mcp/README.md](packages/mcp/README.md), and `skills/deepnote/references/`     |
| Cloud API client behavior                            | [packages/cloud/README.md](packages/cloud/README.md)                                                                                      |
| Local execution and runtime abstractions             | [packages/local-runner/README.md](packages/local-runner/README.md) and [packages/runtime-core/README.md](packages/runtime-core/README.md) |
| Database integration schemas                         | [packages/database-integrations/README.md](packages/database-integrations/README.md)                                                      |
| Dependency and reactive execution behavior           | [packages/reactivity/README.md](packages/reactivity/README.md)                                                                            |
| Deepnote Cloud consumers of these packages           | [deepnote-internal](https://github.com/deepnote/deepnote-internal) (`../deepnote-internal` when available)                                |
| Python kernel and runtime services                   | [deepnote-toolkit](https://github.com/deepnote/deepnote-toolkit) (`../deepnote-toolkit` when available)                                   |
| VS Code, Cursor, and Windsurf integration            | [vscode-deepnote](https://github.com/deepnote/vscode-deepnote) (`../vscode-deepnote` when available)                                      |
