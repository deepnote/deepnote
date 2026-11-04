---
title: Working with notebooks in Git
description: Keep Deepnote notebooks in Git with readable diffs in git diff and pull requests, pre-commit checks with deepnote lint and validate, and outputs kept out of your source files
noIndex: false
noContent: false
---

A `.deepnote` file is plain YAML: one block after another, with its code or text as readable lines
and no outputs mixed in. That makes notebooks behave like the rest of your code in Git — small diffs,
real merges, meaningful history — where `.ipynb` files bury a one-line change under base64 images
and execution counts.

The [Deepnote CLI](/docs/deepnote-cli) makes the rest of the workflow first-class: diffs that show
which blocks changed, checks that stop a broken notebook before it is committed, and a summary of
notebook changes on every pull request.

## Keep outputs out of your source files

`.deepnote` files hold code; outputs live in separate
[`.snapshot.deepnote` files](/docs/run-snapshots) in a `snapshots/` folder next to the notebook.
Commit the `.deepnote` files and decide per repository whether snapshots belong in Git:

- **Ignore them** (add `snapshots/` to `.gitignore`) when outputs are large, change on every run, or
  may contain data that should not be in the repository.
- **Commit them** when you want the results to be reviewable alongside the code, for example a
  report whose numbers should change only on purpose.

To move notebooks from Deepnote into a repository, export them as `.deepnote` files, or mirror the
whole workspace with [`deepnote sync`](/docs/deepnote-cli-sync). To bring Jupyter notebooks in, use
[`deepnote convert`](/docs/converting-notebooks).

## Readable diffs in `git diff` and `git log`

Tell Git to compare notebooks by their blocks. Add this to the repository's `.gitattributes`:

```text
*.deepnote diff=deepnote
```

and register the converter once per machine:

```bash
git config --global diff.deepnote.textconv "sh -c 'deepnote cat \"\$0\" | tail -n +3'"
```

Now `git diff`, `git log -p` and `git show` print notebooks as a list of blocks, each with its type
and id, so a change reads as the code that changed:

```diff
 code (2665e1a332df6436b0ce30d662bfe1f1)

-  print("Hello World!")
+  print("changed")
```

The `tail` drops the first line of `deepnote cat`'s output, which names the temporary file Git
compares.

### A summary of what changed

For a structural overview — which notebooks and blocks were added, removed or modified — use
`deepnote diff` as a difftool:

```bash
git difftool -y -x "deepnote diff --content" -- analysis.deepnote
```

```text
Notebooks:
  ~ Modified: "1. Text blocks"
      ~ code (2665e1a332df6436b0ce30d662bfe1f1)
        - print("Hello World!")
        + print("changed")

Summary:
  ~ 1 notebook(s) modified
  ~ 1 block(s) modified
```

Without `--content` it lists only which blocks changed. Add `-o json` to process the result in a
script.

## Check notebooks before they are committed

Two commands catch broken notebooks before they reach the repository:

- `deepnote validate` checks a file against the `.deepnote` schema — the right fields, block types
  and structure. It exits with `2` for an invalid file.
- `deepnote lint` analyzes the code. Syntax errors and SQL blocks whose integration is not
  configured are errors (exit code `1`); unused and redefined variables and input blocks without a
  value are warnings. It needs a Python 3 interpreter, which it finds the same way
  [`deepnote run`](/docs/deepnote-cli) does, or takes with `--python`.

```text
  ⚠ unused-variable: Variable "x" is defined but never used
    in x = 1
  ✖ parse-error: '(' was never closed (<unknown>, line 1)
    in print(x

Summary: 1 error, 1 warning
```

### With the pre-commit framework

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: deepnote-check
        name: Check Deepnote notebooks
        language: system
        files: \.deepnote$
        exclude: \.snapshot\.deepnote$
        entry: sh -c 'for f; do deepnote validate "$f" && deepnote lint "$f" || exit 1; done' --
```

### As a plain Git hook

```bash
#!/bin/sh
# .git/hooks/pre-commit (make it executable)
git diff --cached --name-only --diff-filter=ACM -- '*.deepnote' ':!*.snapshot.deepnote' |
  while read -r f; do
    deepnote validate "$f" && deepnote lint "$f" || exit 1
  done
```

Both assume the `deepnote` command is installed (`npm install -g @deepnote/cli` or
`pip install deepnote-cli`).

## Review notebook changes in pull requests

Hosted Git services do not apply local diff settings, so a pull request still shows the raw YAML.
Add a CI step that writes a block-level summary of every changed notebook to the job summary:

````yaml
# .github/workflows/notebook-review.yml
name: Notebook review

on: pull_request

permissions:
  contents: read

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v7
        with:
          node-version: lts/*

      - name: Summarize notebook changes
        env:
          BASE: origin/${{ github.base_ref }}
        run: |
          git diff --name-only --diff-filter=AM "$BASE"...HEAD -- '*.deepnote' ':!*.snapshot.deepnote' |
            while read -r file; do
              echo "### \`$file\`"
              echo '```'
              if git cat-file -e "$BASE:$file" 2>/dev/null; then
                git show "$BASE:$file" > "$RUNNER_TEMP/base.deepnote"
                npx @deepnote/cli diff "$RUNNER_TEMP/base.deepnote" "$file" --content
              else
                echo "New notebook"
              fi
              echo '```'
            done >> "$GITHUB_STEP_SUMMARY"

      - name: Lint changed notebooks
        env:
          BASE: origin/${{ github.base_ref }}
        run: |
          git diff --name-only --diff-filter=AM "$BASE"...HEAD -- '*.deepnote' ':!*.snapshot.deepnote' |
            while read -r file; do
              npx @deepnote/cli validate "$file" && npx @deepnote/cli lint "$file" || exit 1
            done
````

This needs no secrets, so it is safe on pull requests from forks. To run the notebooks as well, see
[Running notebooks in CI](/docs/deepnote-cli-ci).

## Related

- [Deepnote file format](/docs/deepnote-format) — what is inside a `.deepnote` file
- [Converting notebooks](/docs/converting-notebooks) — to and from Jupyter, Quarto, percent and marimo
- [Deepnote CLI](/docs/deepnote-cli) — every command
- [Deepnote file sync](/docs/deepnote-file-sync) — let Deepnote keep a project in sync with a Git
  repository for you
