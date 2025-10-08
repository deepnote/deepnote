# 🛠️ Contributing to Deepnote OSS

Thanks for your interest in contributing! 🎉  
Here's how you can get started.

---

## 📂 Repository Structure

```text
deepnote/
├── packages/        # Core TypeScript packages
├── docker/          # Local runtime config
├── .github/         # GitHub workflows & templates
├── CONTRIBUTING.md
└── README.md
```

---

## 🧑‍💻 How to Contribute

We welcome all kinds of contributions:

- 📝 Improving documentation
- 💬 Reporting bugs
- 💡 Requesting features
- 🧪 Writing tests
- 🛠️ Contributing code

Start by opening an issue or discussion to talk through your idea.

---

## 🚀 Local Development

### Prerequisites

> **Note:** Ensure you have [Docker](https://www.docker.com/get-started) installed before proceeding with local development.

### Install dependencies

```bash
pnpm install
```

This will:

- Launch kernel and runtime services
- Simulate core Deepnote runtime behavior

---

## 🧪 Testing

TBD – coming soon.

---

## 🧼 Code Style

We use:

- **TypeScript**
- **Biome** for linting and formatting
- **Vitest** for testing

Run formatters:

```bash
pnpm lint
pnpm format
```

Biome is available as a first-party extension in your favorite editors.

- [VS Code](https://biomejs.dev/guides/editors/first-party-extensions/#vs-code)
- [IntelliJ](https://biomejs.dev/guides/editors/first-party-extensions/#intellij)
- [Zed](https://biomejs.dev/guides/editors/first-party-extensions/#zed)

---

## 📦 Publishing Packages

### Publishing a New Version

To publish a new version of `@deepnote/blocks`:

1. **Update the version** in `packages/blocks/package.json`:

   ```bash
   cd packages/blocks
   pnpm version patch --no-git-tag-version  # or minor/major
   ```

2. **Create a release branch and commit the version bump**:

   ```bash
   git checkout -b release/blocks-v1.2.0
   git add packages/blocks/package.json pnpm-lock.yaml
   git commit -m "chore: bump @deepnote/blocks to v1.2.0"
   git push origin release/blocks-v1.2.0
   ```

3. **Open a pull request**:
   - Go to the repository and open a PR from your release branch to `main`
   - Wait for CI checks to pass
   - Get required approvals from maintainers
   - Merge the PR via GitHub UI or CLI

4. **Create a GitHub Release** (after the PR is merged):
   - Go to [Releases](https://github.com/deepnote/deepnote/releases/new)
   - Create a new tag (e.g., `v1.2.0`) in the release form
   - Add release notes describing the changes
   - Publish the release

The package will be automatically published to GitHub Packages by the `publish.yml` workflow when the release is published

---

## 🧑‍🔧 Maintainer Guidelines

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

## 🙌 Need Help?

[Open an issue](https://github.com/deepnote/deepnote/issues/new). We're happy to help!
