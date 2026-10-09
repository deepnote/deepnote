---
name: bump-package-versions
description: Prepare the PR that bumps the version of every @deepnote/* package with unreleased changes, choosing each package's major, minor, or patch from evidence and waiting for approval before pushing.
disable-model-invocation: true
---

# Bump package versions

Open one PR that raises `version` in `packages/*/package.json` for every package that has something to release. Publishing is out of scope: after merge, maintainers create package-scoped GitHub releases (`CONTRIBUTING.md`, "Publishing packages") and `cd.yml` publishes each one.

`scripts/bump.mjs` does the mechanical checks. Run it from the repository root as `node .claude/skills/bump-package-versions/scripts/bump.mjs <command>`. It reads versions and history from `origin/main` and the fetched tags; `surface` builds the checked-out tree, which steps 1 to 6 keep at `origin/main`. Every command exits 1 when the run should stop.

Rules for the whole run:

- Decide each package's level separately, from the evidence gathered below; never apply one level to every package by default.
- **Stop** means: report what you found and wait for the user.
- Never create tags or GitHub releases. Don't commit or push before the user approves the proposal in step 6.

## 1. Preflight

```bash
git status --porcelain        # must print nothing
gh auth status
git fetch origin main --tags  # stop if a tag is rejected ("would clobber existing tag")
git switch --detach origin/main
gh pr list --state open --search 'bump package versions in:title' --json number,title,author,isDraft,url
```

If a release PR is open, note it. Steps 2 to 6 still work from `origin/main`, step 6 compares the proposal with it, and step 7 updates it instead of opening a second one.

Use the Node version from `.nvmrc` and run `pnpm install --frozen-lockfile`. Its warnings about ignored build scripts and, until step 4 builds the packages, about failing to create the `dist/bin.js` bins are expected.

## 2. Check each package's previous version

Run `bump.mjs baselines`. For every published package it prints the `package.json` version on `origin/main`, the highest stable release tag (`@deepnote/<name>@X.Y.Z`), npm's `latest`, a status, and the internal dependencies, then the publish order with dependencies first. A line under the table explains each status other than `ok`.

- `ok`: the tag is the baseline.
- `never-released`: first publish at the current version, no bump. Ask whether to release it now; its whole history counts.
- `prerelease`: a release line is in flight (e.g. `0.9.0-rc.1` over `0.8.0`). Propose finishing it (`0.9.0`) and ask.
- `unreleased-bump`: a bump merged but was never released. **Stop** and ask: cut that release first, or keep its version as this PR's target (raised only if the changes need more). Never bump twice.
- Any other status: **stop**. Re-run once first for `npm-error` and `publish-pending`, which can be transient; an `npm-error` that ends in an auth code such as `E401` or `E403` won't clear on its own.

## 3. List what merged since the previous version

Run `bump.mjs changes`. For each package it lists the first-parent commits on `origin/main` since the baseline tag (the whole history if never released) that touch the package's directory or another path it ships (see "Package notes"), with their files. Every commit on `main` is one squash-merged PR; the last `(#N)` in its subject is the PR number.

Sort each PR's files by whether they reach users:

- **Ships**: `src/**` except tests and helpers only tests import; the `package.json` fields consumers see (`dependencies`, `peerDependencies`, `engines`, `exports`, `main`, `module`, `types`, `bin`, `files`, `type`) and the install hooks npm runs on their machines (`preinstall`, `install`, `postinstall`); `README.md`; build inputs (`tsdown.config.ts`, the `build` script, build scripts under `scripts/`).
- **Shared build inputs** outside the package (root `tsconfig.json`, the `tsdown` and `typescript` versions in the root `package.json`) change every package's built output. They don't require a release on their own; a released package ships their effect, so rate any difference consumers can see (module format, CommonJS interop, syntax target, `.d.ts` syntax older TypeScript can't read) with the step 5 levels. Package-local edits that only adapt to such a change belong here too, such as the `fixedExtension: false` that #483 added to every `tsdown.config.ts` to keep output file names under the new tsdown.
- **Doesn't ship**: tests, `devDependencies` and the other `scripts`, root `pnpm.overrides` (they pin versions only for installs inside this repository; step 4 shows any that change a bundle), and everything else (`docs/`, `test-fixtures/`, `examples/`, CI).

A package without shipped changes is released only when step 5's dependency rules require it. Classify every PR with shipped changes from its description and its own diff, not its title:

```bash
gh pr view <number> --json title,body,files
git show <sha> -- <paths> ':!*.test.ts'
```

## 4. Diff the public surface against the published release

Run `bump.mjs surface`. It builds the workspace, packs every package that has a baseline, and compares each with its published tarball: the export names of every typed entry point in `exports`, the consumer-facing `package.json` fields (internal dependencies appear as the exact versions pnpm publishes), the packed files and whether their bytes changed, the third-party packages bundled into the output, and the packages its public types import, internal and third-party. It exits 1 when a check couldn't run, such as a `.d.ts` it couldn't parse; compare those by hand.

- A removed export, a removed `exports` or `bin` entry, a raised `engines`, or a packed file that disappears (e.g. `dist/index.d.cts`) is breaking.
- Added names are features.
- Unchanged names don't prove compatibility: #524 added a block type inside existing unions and schemas without adding an export name. Names also miss changed signatures; for those, `diff -u` the two `.d.ts` files in the directory `surface` prints, or read the source diff of the exported modules.
- A new dependency or a raised dependency floor is a fix unless it changes public types. When the public types import that dependency (`public types import` flags its range change), `npm pack` both versions of it and diff the declarations the package exposes.
- `built files: identical` means the build output didn't change; anything that ships changed only in `package.json`, if at all. A package with no shipped changes in step 3 should read that way.
- A changed bundled package ships even when step 3 listed no PR for the package, because a root-only change (a `pnpm.overrides` bump) can cause it. Rate it as a dependency update, and find its PR: `git log --first-parent --format='%h %s' -S'<package>@<version>' <tag>..origin/main -- pnpm-lock.yaml`.
- An entry point without type declarations, and every executable and MCP tool, needs its source diff read; "Package notes" says where each lives.
- To see what a shared build input did to the output, `diff -r` a package's two unpacked tarballs; a package without source changes shows its effect alone. When the bundler's interop helpers change, run the CommonJS build too (`dist/*.cjs`), not only the ESM one.
- A dependent's public types that switch between inlining an internal package's types and importing them (`public types reference` differs from the published version) still resolve through its exact pin; rate only the types that changed.
- `surface` unpacks the tarballs under the system temp directory; set `TMPDIR` to put them elsewhere. Delete the directory it printed once the proposal is approved.

## 5. Decide the bump

### What counts as public API

- **Libraries**: everything exported from the package's `exports` entry points (types, values, Zod schemas) and the behavior its README documents.
- **Executables** (each package's `bin`): commands, arguments, flags, defaults, exit codes, environment variables, config and integration files, and machine-readable output. The wording and layout of human-readable output are not API.
- **MCP server**: tool names, input schemas, result shapes, resources, prompts.
- **`.deepnote` format**: which files the schema accepts, what gets written, and what the generated Python does.
- **HTTP routes** a package serves: paths, methods, request and response shapes, and defaults.
- **Runtime requirements**: `engines.node`, and the required Python or `deepnote-toolkit` versions.

### Level per change

- **Breaking** (major; minor while 0.y.z): a removed or renamed export, command, flag, or MCP tool or parameter; a new required parameter; narrower accepted input or a wider returned type; a changed default or semantics callers rely on; a schema that rejects files it used to accept; a raised runtime requirement.
- **Feature** (minor): a new export, command, flag, optional parameter, MCP tool, or block type; a deprecation.
- **Fix** (patch): a bug fix, performance work, internal refactor, dependency update without an API change, README or bundled-skill text.
- **Re-pin only** (patch): nothing shipped changed, but an internal dependency is released (see below).

Then:

- A package's bump is the highest level among its changes. Minor resets patch to 0; major resets minor and patch.
- 0.y.z: npm's caret range `^0.8.0` means `>=0.8.0 <0.9.0`, so a minor bump is what keeps a breaking change away from existing installs; features take minor too. Once a 0.y.z package has a feature or breaking change, its level is settled; skim its other PRs only for breaking changes, which step 6 lists. Never move a package to 1.0.0 on your own; ask.
- PR titles follow Conventional Commits, but the type is a hint, not evidence: breaking changes here are rarely marked with `!` or `BREAKING CHANGE:`, and #418 (`fix(cli): …`) changed `--input` semantics, which shipped as a breaking-change minor.
- A fix that changes behavior callers depend on is breaking.
- A new block type is a feature for blocks even though it widens the `DeepnoteBlock` union that readers return; dependents that only add support for it take a patch. #336 (the agent block) shipped as blocks 4.3.0 → 4.4.0 and as patches of convert, reactivity, runtime-core, cli, and mcp.
- When the evidence supports two levels, propose the higher one and list it as an open question in step 6. Callers in other Deepnote repositories are evidence: `gh search code '<symbol>' --owner deepnote`.

### Internal dependencies

Internal dependencies are declared `workspace:*`, and pnpm publishes that as an exact version (`@deepnote/mcp@0.4.1` depends on exactly `@deepnote/blocks` `4.7.0`). Using the dependencies `baselines` printed:

1. **Dependents**: when a package is released, also release every package that lists it in `dependencies`, transitively, at least as a patch. Otherwise their published versions stay pinned to the old release and installs carry two copies.
2. **Dependencies**: don't release a package while an internal dependency it uses has unreleased shipped changes. It was built and tested against the workspace source but would install the older published version. Release both or hold both back.
3. **Leaks**: a dependency's change can surface in a dependent's own API; `surface` lists the internal packages each package's public types reference. When a change surfaces, rate the dependent as if the change were its own; new block types follow the rule above.

## 6. Checkpoint: propose and wait

Show the user the following, then stop until they approve or correct it:

1. The `baselines` table.
2. The proposal: Package | From | To | Bump | Driver (PR numbers).
3. Packages not released, each with the reason.
4. Every breaking change per package, including those inside 0.y.z minors, for the release notes.
5. Open questions: every judgment call, with its evidence and the alternative level.
6. If a release PR is open: who opened it, whether it is a draft, and where its versions or release notes differ from this proposal. If someone else opened it, ask whether step 7 may push to it.

## 7. Apply and verify

Put the approved versions on a branch:

- An open release PR: `gh pr checkout <number>`, then `git merge origin/main` (never rebase or force-push it). If someone else opened it, push to it only if the user's approval covered that.
- Otherwise: `git switch -c "release/$(date +%F)"`.

For each package being released, except a never-released one (it keeps its version), run `bump.mjs set-version <name> <X.Y.Z>`. It refuses a version that isn't above the last release, is on npm, has a tag on `origin`, or whose npm lookup fails; sets it with `pnpm version --no-git-tag-version`; and checks that only that line of `package.json` changed. A package already at the target, as on an existing release PR, is left as is.

Then run the checks `AGENTS.md` requires: `pnpm biome:check:fix`, `pnpm test`, `pnpm typecheck`, `pnpm biome:check`. If one fails, stop, and say whether it also fails on `origin/main`: an environment problem, such as no `python` on `PATH`, fails both.

## 8. Commit, push, open the PR

```bash
git add packages/*/package.json
git commit -m 'chore(release): bump package versions' -m '<one line per package: name from -> to; which ones are re-pin only or held back>'
git push -u origin HEAD
gh pr create --base main --title 'chore(release): bump package versions' --body-file <file with the body below>
```

When updating an existing release PR, push, then run `gh pr edit <number> --body-file <file>`.

PR body, following #444:

```markdown
## Versions

| Package            | From   | To       | Bump    | Driver                |
| ------------------ | ------ | -------- | ------- | --------------------- |
| `@deepnote/<name>` | <from> | **<to>** | <level> | <what drives it> (#N) |

Not released: <package: reason>, or "none".

## What each release ships

**`@deepnote/<name>` <to> (<level>)**

Breaking: <each breaking change from step 6, or leave this line out>

- #N <PR title>

## Publish order (after merge)

Create one GitHub release per package from the merge commit, tagged `@deepnote/<name>@<version>`, in this order. Let each `cd.yml` run publish before creating the next, so no published manifest pins a version that isn't on npm yet.

1. `@deepnote/<name>@<to>`

Use each package's "What each release ships" list as its release notes. GitHub's generated notes list every PR in the repository range and may compare against another package's tag.
```

## 9. If main moves before the PR merges

Redo steps 1 to 7 (step 7 merges `origin/main` into the release branch) and update the PR body. A new commit can raise a package's level.

## Package notes

What the scripts and steps above don't derive. Update these when a package's build or public surface changes.

- **`@deepnote/cli`**: `tsdown.config.ts` copies `skills/deepnote/` into `dist/skills`, which ships on npm, in the PyPI wheel, and to users through `deepnote install-skills`; `EXTRA_PATHS` in `scripts/bump.mjs` adds that path to `changes`. Commands and flags are commander definitions in `src/cli.ts`, and `skills/deepnote/references/cli-*.md` document commands, flags, output formats, and exit codes, so their diff lists the intended CLI changes. The PyPI package `deepnote-cli` takes its version from `packages/cli/package.json` at publish time.
- **`@deepnote/mcp`**: each tool's name, input schema, and result are defined in `src/tools/*.ts`; `deepnote-mcp` starts in `src/bin.ts`.
- **`@deepnote/convert`**: `deepnote-convert` starts in `src/bin.ts`. Convert also writes `.deepnote` files.
- **`@deepnote/blocks`**: `src/deepnote-file/deepnote-file-schema.ts` defines which `.deepnote` files are accepted. Its `.d.ts` is thousands of lines of Zod-inferred types; read the source diff of its exported modules instead.
- **`@deepnote/local-runner`**: `./snapshot-reader` is a browser bundle (global `DeepnoteSnapshot`) built from `src/browser.ts` with blocks and its third-party dependencies inlined, so a root-only `pnpm.overrides` bump can change what it ships. Its static server's `/api/*` routes are in `src/serve-static.ts`.
