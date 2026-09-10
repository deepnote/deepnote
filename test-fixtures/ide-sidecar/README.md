# Deepnote extension sidecar fixtures

The Deepnote extension for VS Code, Cursor, and Antigravity records the interpreter it selected for a
notebook in a `deepnote.json` sidecar (`.vscode/deepnote.json`, `.cursor/deepnote.json`, or
`.antigravity/deepnote.json` in the workspace root). `deepnote run`, `analyze`, `lint`, `dag`, and the
MCP `deepnote_run` tool read it when no interpreter is given explicitly. These fixtures pin the two
shapes of that file so the CLI, the MCP, and the extension cannot drift apart silently.

| Fixture              | Written by                                                                   | Fields                                           |
| -------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------ |
| `deepnote.slim.json` | Extension versions that only record the selected interpreter (current shape) | `pythonInterpreter`                              |
| `deepnote.full.json` | Older versions that managed a virtual environment per project                | `environmentId`, `venvPath`, `pythonInterpreter` |

Both are keyed by the `.deepnote` file's `project.id`. The id in these fixtures matches
`test-fixtures/simple.deepnote`, so the two can be paired in tests.

Consumers resolve an entry as follows: use `pythonInterpreter` when it points at an existing file;
otherwise, if `venvPath` is present, use the interpreter inside that venv; otherwise skip the entry with
a warning. `environmentId` is informational only and is omitted from CLI and MCP output when absent.

The `<PYTHON_INTERPRETER>` and `<VENV_PATH>` placeholders stand for absolute paths; tests substitute
paths that exist on the machine running them before writing a fixture into a temporary workspace.
