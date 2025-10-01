# 🛠️ Contributing to Deepnote OSS

Thanks for your interest in contributing! 🎉  
Here's how you can get started.

---

## 📂 Repository Structure

```
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
- **Jest** for testing

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

## 📄 License

By contributing, you agree your work will be released under the Apache 2 License.

---

## 🙌 Need Help?

[Open an issue](https://github.com/deepnote/deepnote/issues/new). We're happy to help!
