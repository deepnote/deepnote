# 🛠️ Contributing to Deepnote OSS

Thanks for your interest in contributing! 🎉  
Here's how you can get started.

---

## 📂 Repository structure

```text
deepnote/
├── packages/                  # Core TypeScript packages
│   ├── blocks/                # @deepnote/blocks - Block types, schemas, and Python code generation
│   ├── cli/                   # @deepnote/cli - CLI for running Deepnote projects locally and on Deepnote Cloud
│   ├── cloud/                 # @deepnote/cloud - Client for the Deepnote Cloud runs API
│   ├── convert/                # @deepnote/convert - Bidirectional converter between Jupyter and Deepnote
│   ├── database-integrations/ # @deepnote/database-integrations - Database integration definitions and schemas
│   ├── local-runner/          # @deepnote/local-runner - Local Python-backed runner and static UI
│   ├── mcp/                   # @deepnote/mcp - MCP server for AI-assisted notebook creation
│   ├── reactivity/            # @deepnote/reactivity - Reactivity and dependency graph
│   └── runtime-core/          # @deepnote/runtime-core - Core runtime for executing Deepnote projects
├── skills/deepnote/           # Agent-facing reference docs (kept in sync with the packages above)
├── test-fixtures/             # Shared test fixtures used across packages
├── docs/                      # Documentation files
├── .github/                   # GitHub workflows & templates
│   └── workflows/             # CI/CD pipelines
├── AGENTS.md
├── CONTRIBUTING.md
└── README.md
```

---

## 🧑‍💻 How to contribute

We welcome all kinds of contributions:

- 📝 Improving documentation
- 💬 Reporting bugs
- 💡 Requesting features
- 🧪 Writing tests
- 🛠️ Contributing code

Start by opening an issue or discussion to talk through your idea.

---

## 🚀 Local development

### Prerequisites

- Node.js, matching the version in [`.nvmrc`](.nvmrc) (e.g. `nvm use`)
- [pnpm](https://pnpm.io/), matching the version in the `packageManager` field of `package.json`
- To run `packages/local-runner` locally, a Python environment with [`deepnote-toolkit[server]`](https://pypi.org/project/deepnote-toolkit/) installed (see that package's README)

### Install dependencies

```bash
pnpm install
```

This will install all dependencies for the monorepo and its packages.

---

## 🧪 Testing

Run tests across all packages:

```bash
pnpm test
```

Run tests with coverage:

```bash
pnpm test:coverage
```

Run tests in watch mode (in a specific package):

```bash
cd packages/blocks
pnpm test
```

---

## 🧼 Code style

We use:

- **TypeScript** for type safety
- **Biome** for linting and formatting TypeScript/JavaScript files
- **Prettier** for formatting Markdown and YAML files
- **Vitest** for testing
- **cspell** for spell checking

Run linting and formatting:

```bash
pnpm lintAndFormat        # Check for issues
pnpm lintAndFormat:fix    # Auto-fix issues
```

Run type checking:

```bash
pnpm typecheck
```

Run spell checking:

```bash
pnpm spell-check
```

Biome is available as a first-party extension in your favorite editors.

- [VS Code](https://biomejs.dev/guides/editors/first-party-extensions/#vs-code)
- [IntelliJ](https://biomejs.dev/guides/editors/first-party-extensions/#intellij)
- [Zed](https://biomejs.dev/guides/editors/first-party-extensions/#zed)

---

## 📦 Publishing packages

### Publishing a new version

This repository supports publishing multiple packages independently. Each package release must use a **package-scoped tag** in the format `@deepnote/package-name@version` (e.g., `@deepnote/blocks@1.2.0`).

To publish a new version of a package (using `@deepnote/blocks` as an example):

1. **Update the version** in the package's `package.json`:

   ```bash
   cd packages/blocks
   pnpm version patch --no-git-tag-version  # or minor/major
   cd ../..
   ```

2. **Create a release branch and commit the version bump**:

   ```bash
   git checkout -b release/blocks-1.2.0
   git add -A
   git commit -m "chore: bump @deepnote/blocks to 1.2.0"
   git push origin release/blocks-1.2.0
   ```

3. **Open a pull request**:
   - Go to the repository and open a PR from your release branch to `main`
   - Wait for CI checks to pass
   - Get required approvals from maintainers
   - Merge the PR via GitHub UI or CLI

4. **Create a GitHub release** (after the PR is merged):
   - Go to [Releases](https://github.com/deepnote/deepnote/releases/new)
   - Create a new tag using the **package-scoped format**: `@deepnote/blocks@1.2.0`
   - Add a release title (e.g., `@deepnote/blocks v1.2.0`)
   - Add release notes describing the changes
   - Publish the release

The package will be automatically published to **npm** by the `cd.yml` workflow when the release is published. The workflow:

- Only triggers for tags matching `@deepnote/*@*`
- Validates that the tag version matches the package.json version
- Builds and publishes only the specified package
- Requires the `NPM_TOKEN` secret to be configured in the `release` environment

---

## 🧑‍🔧 Maintainer guidelines

- The `main` branch is protected: no direct commits or force pushes are allowed. All changes must be merged through pull requests.
- Never rebase or force push branches owned by others. If you must help finish their PR and it’s behind main, merge main into their branch and resolve conflicts in the merge commit. Otherwise, prefer adding your own commits or opening a follow-up PR instead of modifying their branch.
- Keep pull requests small and focused on a single purpose. Unless your PR is entirely self-explanatory, link the related issue in your PR description.
- Respect authorship: only add `Co-authored-by:` lines with explicit consent.
- Maintain issue hygiene: label issues consistently (`bug`, `feat`, `chore`, etc.) and close them only with a final comment explaining the resolution, linking to the relevant PR or documentation. See [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/#summary).
- If decisions happen in Slack, meetings, or other offline channels, post a short TL;DR summary in the relevant issue or PR so the full context is preserved.

---

## 📄 License

By contributing, you agree your work will be released under the Apache 2 License.

---

## 🙌 Need help?

[Open an issue](https://github.com/deepnote/deepnote/issues/new). We're happy to help!
