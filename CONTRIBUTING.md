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

## 🧑‍🔧 Maintainer Guidelines

- The `main` branch is protected: no direct commits or force pushes are allowed. All changes must be merged through pull requests.
- Never rebase or force push branches owned by others. If you must help finish their PR and it’s behind main, merge main into their branch and resolve conflicts in the merge commit. Otherwise, prefer adding your own commits or opening a follow-up PR instead of modifying their branch.
- Keep pull requests small and focused on a single purpose. Unless your PR is entirely self-explanatory, link the related issue in your PR description.
- Respect authorship: only add `Co-authored-by:` lines with explicit consent.
- Maintain issue hygiene: label issues consistently (`bug`, `feat`, `chore`, etc.) and close them only with a final comment explaining the resolution, linking to the relevant PR or documentation. See [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/#summary).

---

## 📄 License

By contributing, you agree your work will be released under the Apache 2 License.

---

## 🙌 Need Help?

[Open an issue](https://github.com/deepnote/deepnote/issues/new). We're happy to help!
