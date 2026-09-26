---
name: bump-package-versions
description: Prepare and open the release PR that bumps the version of every @deepnote/* package with unreleased changes. Finds each package's last release tag, lists what merged since, picks major/minor/patch per package from evidence (PR diffs, exported API and packed files diffed against the published tarball, internal dependency pins), pauses for approval, then pushes and opens the PR.
disable-model-invocation: true
---

# Bump package versions

Open one PR that raises `version` in `packages/*/package.json` for every package that has something to release. Publishing is out of scope: after merge, maintainers create package-scoped GitHub releases (`CONTRIBUTING.md`, "Publishing packages") and `cd.yml` publishes each one.

Rules for the whole run:

- Decide each package's level separately, from the evidence gathered below; never apply one level to every package by default.
- Read versions and history from `origin/main` and the fetched tags, not from memory or the checked-out branch.
- `<angle-bracket>` values in commands are placeholders to fill in. Shell variables don't survive between separate commands, so run each loop below as one script.
- Every `npm view` and `npm pack` pins `--@deepnote:registry=https://registry.npmjs.org/`, the registry `cd.yml` publishes to. A plain `--registry` doesn't override a scoped registry set in someone's `.npmrc`.
- **Stop** means: report what you found and wait for the user.
- Never create tags or GitHub releases. Don't commit or push before the user approves the proposal in step 6.

## 1. Preflight

```bash
git status --porcelain        # must print nothing
gh auth status
git fetch origin main --tags  # stop if a tag is rejected ("would clobber existing tag")
gh pr list --state open --search 'bump package versions in:title' --json number,title,headRefName,url
```

- An open release PR exists: update it instead of opening a second one. Run `gh pr checkout <number>`, then `git merge origin/main` (never rebase or force-push it).
- Otherwise: `git switch -c "release/$(date +%F)" origin/main`.

Use the Node version from `.nvmrc` and run `pnpm install --frozen-lockfile`; step 4 builds the packages.

## 2. Find each package's previous version

A package's previous version is its highest **stable** release tag, `@deepnote/<name>@X.Y.Z`, the format `cd.yml` publishes from. Drop prerelease tags before picking the highest: `git tag --sort=-v:refname` ranks `@deepnote/cli@0.1.0-rc.4` above `@deepnote/cli@0.1.0`.

```bash
npm_err=$(mktemp)
for dir in $(git ls-tree --name-only origin/main packages/); do
  json=$(git show "origin/main:$dir/package.json" 2>/dev/null) || continue
  node -e 'process.exit(JSON.parse(process.argv[1]).private ? 0 : 1)' "$json" && continue
  name=$(node -p 'JSON.parse(process.argv[1]).name' "$json")
  version=$(node -p 'JSON.parse(process.argv[1]).version' "$json")
  tag=$(git tag --list "$name@*" --sort=-v:refname | grep -E '@[0-9]+\.[0-9]+\.[0-9]+$' | head -1)
  npm_latest=$(npm view "$name" dist-tags.latest --@deepnote:registry=https://registry.npmjs.org/ 2>"$npm_err")
  grep -q 'code E404' "$npm_err" && npm_latest=none
  on_remote=-; on_main=-
  if [ -n "$tag" ]; then
    git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null && on_remote=yes || on_remote=no
    git merge-base --is-ancestor "$tag" origin/main && on_main=yes || on_main=no
  fi
  echo "$name dir=$dir package.json=$version tag=${tag:-none} npm=${npm_latest:-ERROR} tag-on-remote=$on_remote tag-on-main=$on_main"
done
```

The tag is the baseline only when `package.json`, the tag, and `npm` agree, and the tag is both on the remote and an ancestor of `origin/main`. Otherwise:

| Observation                                            | Meaning                                                               | Action                                                                                                                                                           |
| ------------------------------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm=ERROR`                                            | Lookup failed (network, auth, registry); only a 404 prints `npm=none` | Re-run this loop; if it persists, **stop**.                                                                                                                      |
| `tag=none`, `npm=none`                                 | Never released                                                        | First publish at the current version, no bump. Ask whether to release it now (#444 first shipped `cloud` and `local-runner` at 0.1.0). Its whole history counts. |
| `package.json` above the tag and `npm`                 | A bump merged but was never released                                  | **Stop** and ask: cut that release first, or keep its version as this PR's target (raised only if the changes need more). Never bump twice.                      |
| Tag exists, `npm` lower or `none`                      | Release created but publish failed or is still running                | Re-run `npm view`; if it persists, **stop**.                                                                                                                     |
| `npm` above the tag                                    | Published outside the release flow                                    | **Stop**.                                                                                                                                                        |
| `tag-on-remote=no`                                     | Local-only tag                                                        | **Stop**.                                                                                                                                                        |
| `tag-on-main=no`                                       | Released from another branch                                          | **Stop**: `<tag>..origin/main` would list the wrong commits.                                                                                                     |
| `git tag --list '<name>@*-*'` shows a newer prerelease | A release line is in flight (e.g. `0.9.0-rc.1` over `0.8.0`)          | Propose finishing it (`0.9.0`) and ask.                                                                                                                          |

## 3. List what merged since the previous version

Every commit on `main` is one squash-merged PR; the last `(#N)` in its subject is the PR number. A package's changes are the commits since its baseline tag that touch its paths:

- `packages/<dir>/` for every package;
- plus `skills/deepnote/` for `@deepnote/cli`: its build copies that directory into `dist/skills`, which ships on npm, in the PyPI wheel, and to users through `deepnote install-skills`.

```bash
for tag in <baseline tags from step 2>; do
  name=${tag%@*}; dir=packages/${name#@deepnote/}
  paths=$dir; [ "$name" = @deepnote/cli ] && paths="$dir skills/deepnote"
  echo "== $name since ${tag##*@}"
  git log --first-parent --reverse --format='--- %h %cs %s' --name-only "$tag"..origin/main -- $paths
done
```

For a never-released package, run the same `git log` without `"$tag"..`.

Sort each PR's files by whether they reach users:

- **Ships**: `src/**` except tests (`*.test.ts`) and helpers only tests import; `package.json` fields consumers see (`dependencies`, `engines`, `exports`, `bin`, `files`, `type`); `README.md`; build inputs (`tsdown.config.ts`, build scripts under `scripts/`); for the CLI, `pypi/**` and `skills/deepnote/**`. `@deepnote/local-runner`'s `dist/snapshot-reader.iife.js` bundles blocks and its third-party dependencies, so a PR that changes only the root `package.json` and `pnpm-lock.yaml` (a `pnpm.overrides` bump) can change what it ships; step 4 diffs the bundled versions.
- **Shared build inputs** outside these paths (root `tsconfig.json`, the `tsdown` and `typescript` versions in the root `package.json`) change every package's built output without changing its file names. They don't require a release on their own; a released package ships their effect, so rate any difference consumers can see (module format, syntax target, `.d.ts` syntax older TypeScript can't read) with the step 5 table.
- **Doesn't ship**: tests, `devDependencies` and `scripts` in `package.json`, and everything else outside the paths above (`docs/`, `test-fixtures/`, `examples/`, CI).

A package without shipped changes is released only when step 5's dependency rules require it. Classify every PR with shipped changes from its description and its own diff, not its title:

```bash
gh pr view <number> --json title,body,files
git show <sha> -- <paths> ':!*.test.ts'
```

## 4. Diff the public surface against the published release

Build, then compare every package that has a baseline tag with that release's tarball from npm: the exported names in `dist/index.d.ts`, the `package.json` fields consumers see (dependency keys sorted, because `pnpm pack` writes them in varying order), the packed file list with content-hashed chunk names normalized, and the third-party package versions inlined into the bundles. The directory is derived from the package name the same way `cd.yml` does it.

```bash
pnpm build
work=$(mktemp -d); echo "tarballs in $work"
exports_of() { grep -h '^export {' "$1" | sed -E 's/^export \{ //; s/ \};?$//' | tr ',' '\n' | sed -E 's/^ +//; s/^type //; s/^.* as //' | sort -u; }
manifest_of() { tar -xOzf "$1" package/package.json | node -e 'const sorted = o => o && Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]])); const { exports, bin, main, module, types, type, engines, dependencies, peerDependencies, files } = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(JSON.stringify({ exports, bin, main, module, types, type, engines, dependencies: sorted(dependencies), peerDependencies: sorted(peerDependencies), files }, null, 2))'; }
files_of() { tar -tzf "$1" | sed -E 's/-[A-Za-z0-9_-]{8}\.(c?js|d\.c?ts)$/-[hash].\1/' | sort -u; }
bundled_of() { tar -xOzf "$1" | grep -aoE '//#region [^ ]*node_modules/\.pnpm/[^/]+' | sed -E 's#.*/\.pnpm/##' | sort -u; }
for tag in <baseline tags from step 2>; do
  name=${tag%@*}; dir=packages/${name#@deepnote/}
  mkdir -p "$work/prev/$name" "$work/next/$name"
  (cd "$work/prev/$name" && npm pack "$tag" --silent --@deepnote:registry=https://registry.npmjs.org/ | xargs tar -xzf)
  (cd "$dir" && pnpm pack --pack-destination "$work/next/$name" >/dev/null)
  echo "== $name: exports (< removed, > added)"
  diff <(exports_of "$work/prev/$name/package/dist/index.d.ts") <(exports_of "$dir/dist/index.d.ts")
  echo "== $name: package.json"
  diff <(manifest_of "$work/prev/$name"/*.tgz) <(manifest_of "$work/next/$name"/*.tgz)
  echo "== $name: packed files (< removed, > added)"
  diff <(files_of "$work/prev/$name"/*.tgz) <(files_of "$work/next/$name"/*.tgz)
  echo "== $name: bundled third-party packages (< removed, > added)"
  diff <(bundled_of "$work/prev/$name"/*.tgz) <(bundled_of "$work/next/$name"/*.tgz)
done
```

Export names miss changed signatures. For those, diff one package's declarations: `diff -u <work>/prev/<name>/package/dist/index.d.ts packages/<dir>/dist/index.d.ts`. For blocks that is thousands of lines of Zod-inferred types; read the source diff of its exported modules instead. `@deepnote/local-runner`'s `./snapshot-reader` entry has no `.d.ts`; read the diff of `packages/local-runner/src/browser.ts` and what it imports.

For the executables and the MCP server:

```bash
git diff <cli tag>..origin/main -- packages/cli/src/cli.ts | grep -E '^[-+].*\.(command|option|requiredOption|argument|addOption|alias)\('
git diff <cli tag>..origin/main -- packages/cli/src ':!*.test.ts' | grep -E '^[-+].*(exitCode|process\.exit|exitOverride)'
git diff --stat <cli tag>..origin/main -- skills/deepnote/references/
git diff <mcp tag>..origin/main -- packages/mcp/src/tools ':!*.test.ts' | grep -E "^[-+][[:space:]]+name: '"
```

These greps point into the diff; they are not verdicts. A multi-line definition shows only its first line, and a `-` hit can be an edit (a hidden flag made visible) rather than a removal, so open the diff around each hit. `skills/deepnote/references/cli-*.md` document commands, flags, output formats, and exit codes, so their diff lists the intended CLI changes. MCP input schemas and result shapes aren't in the name grep; read `git diff <mcp tag>..origin/main -- packages/mcp/src/tools ':!*.test.ts'`. `deepnote-convert` (`packages/convert/src/bin.ts`) and `deepnote-mcp` (`packages/mcp/src/bin.ts`) have no grep; read their diffs.

Reading the output:

- A removed export (`<`), or a command, flag, or MCP tool the diff shows removed or renamed, is breaking.
- Added names are features.
- Unchanged names don't prove compatibility: #524 added a block type inside existing unions and schemas without adding an export name.
- In the `package.json` diff, a removed `exports` or `bin` entry or a raised `engines` is breaking; a new dependency or a raised dependency floor is a fix unless it changes public types.
- A packed file that disappears (e.g. `dist/index.d.cts`) is breaking. New `dist/skills/**` files in the CLI are the bundled agent skill.
- A changed bundled package ships even when step 3 listed no PR for the package: its path filter skips PRs that change only root files. Rate it as a dependency update, and find its PR from the `>` line: `git log --first-parent --format='%h %s' -S'<package>@<version>' <tag>..origin/main -- pnpm-lock.yaml`.
- If `exports_of` prints nothing on either side, the `.d.ts` layout changed. Compare by hand; silence is not "no change".

## 5. Decide the bump

### What counts as public API

- **Libraries**: everything exported from the package's `exports` entry points (types, values, Zod schemas) and the behavior its README documents. `@deepnote/local-runner` also exports `./snapshot-reader` (browser global `DeepnoteSnapshot`).
- **Executables** `deepnote` (cli), `deepnote-convert` (convert), `deepnote-mcp` (mcp): commands, arguments, flags, defaults, exit codes, environment variables, config and integration files, and machine-readable output. The wording and layout of human-readable output are not API.
- **MCP server** (mcp): tool names, input schemas, result shapes, resources, prompts.
- **`.deepnote` format** (blocks, and convert as a writer): which files `packages/blocks/src/deepnote-file/deepnote-file-schema.ts` accepts, what gets written, and what the generated Python does.
- **Runtime requirements**: `engines.node`, and the required Python or `deepnote-toolkit` versions.

### Level per change

| Change                                                                                                                                                                                                                                                                                      | ≥ 1.0.0 | 0.y.z |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ----- |
| **Breaking**: a removed or renamed export, command, flag, or MCP tool or parameter; a new required parameter; narrower accepted input or a wider returned type; a changed default or semantics callers rely on; a schema that rejects files it used to accept; a raised runtime requirement | major   | minor |
| **Feature**: a new export, command, flag, optional parameter, MCP tool, or block type; a deprecation                                                                                                                                                                                        | minor   | minor |
| **Fix**: a bug fix, performance work, internal refactor, dependency update without an API change, README or bundled-skill text                                                                                                                                                              | patch   | patch |
| **Re-pin only**: nothing shipped changed, but an internal dependency is released (see below)                                                                                                                                                                                                | patch   | patch |

- A package's bump is the highest level among its changes. Minor resets patch to 0; major resets minor and patch.
- 0.y.z: npm's caret range `^0.8.0` means `>=0.8.0 <0.9.0`, so a minor bump is what keeps a breaking change away from existing installs. Features take minor too, as in #308, #406, and #444. Never move a package to 1.0.0 on your own; ask.
- PR titles follow Conventional Commits, but the type is a hint, not evidence: breaking changes here are rarely marked with `!` or `BREAKING CHANGE:`, and #418 (`fix(cli): …`) changed `--input` semantics, which #444 released as a breaking-change minor.
- A fix that changes behavior callers depend on is breaking.
- A new block type is a feature for blocks even though it widens the `DeepnoteBlock` union that readers return; dependents that only add support for it take a patch. #336 (the agent block) shipped as blocks 4.3.0 → 4.4.0 and as patches of convert, reactivity, runtime-core, cli, and mcp.
- When the evidence supports two levels, propose the higher one and list it as an open question in step 6.

### Internal dependencies

Internal dependencies are declared `workspace:*`, and pnpm publishes that as an exact version (`@deepnote/mcp@0.4.1` depends on exactly `@deepnote/blocks` `4.7.0`). Therefore:

1. **Dependents**: when a package is released, also release every package that lists it in `dependencies`, transitively, at least as a patch. Otherwise their published versions stay pinned to the old release and installs carry two copies.
2. **Dependencies**: don't release a package while an internal dependency it uses has unreleased shipped changes. It was built and tested against the workspace source but would install the older published version. Release both or hold both back.
3. **Leaks**: a dependency's change can surface in a dependent's own API; `runtime-core`, for example, re-exports `DeepnoteBlock` and `DeepnoteFile`. `grep -oE "from ['\"]@deepnote/[a-z-]+['\"]" packages/<dir>/dist/index.d.ts | sort -u` lists the internal packages whose types appear in a package's public types. When a change surfaces, rate the dependent with the table as if the change were its own; new block types follow the rule above.

The dependency graph, and the publish order with dependencies first:

```bash
for pj in packages/*/package.json; do node -e 'const p=require(process.argv[1]); console.log(p.name, "->", Object.keys(p.dependencies ?? {}).filter(d => d.startsWith("@deepnote/")).join(" ") || "-")' "./$pj"; done
pnpm -r --workspace-concurrency=1 exec node -p "require('./package.json').name"
```

## 6. Checkpoint: propose and wait

Show the user the following, then stop until they approve or correct it:

1. The step 2 line for every package.
2. The proposal: Package | From | To | Bump | Driver (PR numbers).
3. Packages not released, each with the reason.
4. Open questions: every judgment call, with its evidence and the alternative level.

## 7. Apply and verify

For each package being released (skip a never-released package, which keeps its version, and one already at the target on an existing release PR):

```bash
npm view <name>@<new> version --@deepnote:registry=https://registry.npmjs.org/ 2>&1 | grep 'code E404'  # must print the E404 line
git ls-remote --tags origin 'refs/tags/<name>@<new>'  # must print nothing
(cd <dir> && pnpm version <new> --no-git-tag-version)
```

- Only an E404 proves `<new>` is unpublished. No output means npm found the version or the lookup failed; stop in both cases.
- Always pass `--no-git-tag-version`; without it the command commits and tags locally, and release tags come only from GitHub releases. Pass the explicit version, not `patch`, `minor`, or `major`.
- `git diff --stat` must list only `packages/*/package.json`, one changed line each. `pnpm-lock.yaml` must not change, because workspace dependencies are `link:` entries without versions. The PyPI package `deepnote-cli` takes its version from `packages/cli/package.json` at publish time.

Then run the checks `AGENTS.md` requires, and stop if any fails: `pnpm biome:check:fix`, `pnpm test`, `pnpm typecheck`, `pnpm biome:check`.

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

- #N <PR title>

## Publish order (after merge)

Create one GitHub release per package from the merge commit, tagged `@deepnote/<name>@<version>`, in this order. Let each `cd.yml` run publish before creating the next, so no published manifest pins a version that isn't on npm yet.

1. `@deepnote/<name>@<to>`

Use each package's "What each release ships" list as its release notes. GitHub's generated notes list every PR in the repository range and may compare against another package's tag.
```

## 9. If main moves before the PR merges

Merge `origin/main` into the branch, redo steps 2 to 7 for the new commits, and update the PR body. #406 had to raise `convert` from patch to major this way.

## Sources

- [Semantic Versioning 2.0.0](https://semver.org/): spec items 4 to 8, and the FAQ on 0.y.z, deprecation, and dependency updates.
- [npm: About semantic versioning](https://docs.npmjs.com/about-semantic-versioning/) and [node-semver caret ranges](https://github.com/npm/node-semver#caret-ranges-123-025-004).
- [Semantic Versioning for TypeScript Types](https://www.semver-ts.org/): which type changes are breaking.
- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).
- [Command Line Interface Guidelines: Future-proofing](https://clig.dev/#future-proofing).
- [pnpm: Publishing workspace packages](https://pnpm.io/workspaces#publishing-workspace-packages).
- [Changesets: versioning decisions for dependents](https://github.com/changesets/changesets/blob/main/docs/decisions.md).
