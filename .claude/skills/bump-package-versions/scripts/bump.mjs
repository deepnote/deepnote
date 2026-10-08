// Mechanical steps of the bump-package-versions skill:
//   node .claude/skills/bump-package-versions/scripts/bump.mjs <baselines|changes|surface|set-version> [args]
// Versions and history come from origin/main and the fetched tags, never the checked-out branch; `surface` packs
// the working tree and `set-version` edits it. Exits 1 when the run should stop.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

const REF = 'origin/main'
// The registry cd.yml publishes to. A plain --registry doesn't override a scoped registry set in someone's .npmrc.
const NPM_REGISTRY = '--@deepnote:registry=https://registry.npmjs.org/'
// Shipped paths outside packages/<dir>/: the CLI's tsdown.config.ts copies skills/deepnote into dist/skills.
const EXTRA_PATHS = { '@deepnote/cli': ['skills/deepnote'] }
const CONSUMER_FIELDS = [
  'exports',
  'bin',
  'main',
  'module',
  'types',
  'type',
  'engines',
  'dependencies',
  'peerDependencies',
  'optionalDependencies',
  'files',
]
// npm runs these on consumers' machines.
const INSTALL_HOOKS = ['preinstall', 'install', 'postinstall']
const CHUNK_HASH = /-[\w-]{8}(?=\.(?:[cm]?js|d\.[cm]?ts)$)/

const STATUS_MEANINGS = {
  ok: 'package.json, the tag, and npm agree; the tag is the baseline',
  'never-released': 'no release tag, and not on npm',
  prerelease: 'a prerelease above the baseline is in flight',
  'unreleased-bump': 'package.json is above the tag: a bump merged but was never released',
  'version-behind': 'package.json is below the tag',
  'publish-pending': 'npm is behind the tag: the publish failed or is still running',
  'published-outside-flow': 'npm has a version that no release tag accounts for',
  'tag-not-on-remote': 'the tag exists only locally',
  'tag-not-on-main': 'the tag is not an ancestor of origin/main, so <tag>..origin/main would list the wrong commits',
  'npm-error': 'the npm lookup failed (network, auth, registry)',
}
const CONTINUE_STATUSES = new Set(['ok', 'never-released', 'prerelease'])

const print = (line = '') => process.stdout.write(`${line}\n`)

function fail(message) {
  throw new Error(message)
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
    // npm and git block indefinitely on a black-holed connection.
    timeout: 2 * 60 * 1000,
    ...options,
  })
}

// For commands whose exit status is the answer; any status outside 0 and `expected` throws.
function exitStatus(command, args, expected) {
  try {
    run(command, args)
    return 0
  } catch (error) {
    if (expected.includes(error.status)) {
      return error.status
    }
    throw error
  }
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version)
  return match && { core: match.slice(1, 4).map(Number), prerelease: match[4] }
}

// Orders by X.Y.Z, then a release above its own prereleases. Prereleases of one X.Y.Z compare equal.
function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)]
  const differing = x.core.findIndex((part, i) => part !== y.core[i])
  if (differing !== -1) {
    return x.core[differing] - y.core[differing]
  }
  return Number(!x.prerelease) - Number(!y.prerelease)
}

function listPackages() {
  return run('git', ['ls-tree', '-r', '--name-only', REF, '--', 'packages'])
    .split('\n')
    .filter(file => /^packages\/[^/]+\/package\.json$/.test(file))
    .map(file => ({ dir: path.dirname(file), manifest: JSON.parse(run('git', ['show', `${REF}:${file}`])) }))
    .filter(({ manifest }) => !manifest.private)
    .map(({ dir, manifest }) => ({
      dir,
      name: manifest.name,
      version: manifest.version,
      deps: Object.keys(manifest.dependencies ?? {}).filter(dep => dep.startsWith('@deepnote/')),
    }))
}

function selectPackages(names) {
  const packages = listPackages()
  const unknown = names.filter(name => !packages.some(pkg => pkg.name === name))
  if (unknown.length > 0) {
    fail(`not a published package on ${REF}: ${unknown.join(', ')}`)
  }
  return names.length > 0 ? packages.filter(pkg => names.includes(pkg.name)) : packages
}

function releaseTags(name) {
  return run('git', ['tag', '--list', `${name}@*`])
    .split('\n')
    .map(tag => ({ tag, version: tag.slice(name.length + 1) }))
    .filter(({ version }) => parseVersion(version))
}

function stableTag(name) {
  return releaseTags(name)
    .filter(({ version }) => !parseVersion(version).prerelease)
    .sort((a, b) => compareVersions(b.version, a.version))[0]
}

function npmErrorCode(error) {
  try {
    return JSON.parse(error.stdout).error.code
  } catch {
    return undefined
  }
}

// null only when npm answers 404, so a failed lookup never reads as "not published".
function npmView(spec, field) {
  try {
    return JSON.parse(run('npm', ['view', spec, field, '--json', NPM_REGISTRY]))
  } catch (error) {
    if (npmErrorCode(error) === 'E404') {
      return null
    }
    throw error
  }
}

function remoteTagExists(tag) {
  return exitStatus('git', ['ls-remote', '--exit-code', '--tags', 'origin', `refs/tags/${tag}`], [2]) === 0
}

function isOnMain(tag) {
  return exitStatus('git', ['merge-base', '--is-ancestor', tag, REF], [1]) === 0
}

function checkBaseline(pkg) {
  const tag = stableTag(pkg.name)
  const prereleases = releaseTags(pkg.name).filter(
    ({ version }) => parseVersion(version).prerelease && (!tag || compareVersions(version, tag.version) > 0)
  )
  const result = { tag, prereleases }
  let npm
  try {
    npm = npmView(pkg.name, 'dist-tags.latest')
  } catch (error) {
    const detail = npmErrorCode(error) ?? error.code ?? error.message.split('\n')[0]
    return { ...result, npm: 'ERROR', status: 'npm-error', detail }
  }
  result.npm = npm ?? 'none'

  if (!tag) {
    return { ...result, status: npm ? 'published-outside-flow' : 'never-released' }
  }
  if (!remoteTagExists(tag.tag)) {
    return { ...result, status: 'tag-not-on-remote' }
  }
  if (!isOnMain(tag.tag)) {
    return { ...result, status: 'tag-not-on-main' }
  }
  // A prerelease cut from main leaves package.json at its version, and cd.yml's publish (no --tag) can make it latest.
  const current = prereleases.find(prerelease => prerelease.version === pkg.version)
  if (
    current &&
    (npm === tag.version || npm === current.version) &&
    remoteTagExists(current.tag) &&
    isOnMain(current.tag)
  ) {
    return { ...result, status: 'prerelease' }
  }
  if (!npm || compareVersions(npm, tag.version) < 0) {
    return { ...result, status: 'publish-pending' }
  }
  if (compareVersions(npm, tag.version) > 0) {
    return { ...result, status: 'published-outside-flow' }
  }
  const packageVsTag = compareVersions(pkg.version, tag.version)
  if (packageVsTag > 0) {
    return { ...result, status: 'unreleased-bump' }
  }
  if (packageVsTag < 0) {
    return { ...result, status: 'version-behind' }
  }
  return { ...result, status: prereleases.length > 0 ? 'prerelease' : 'ok' }
}

function publishOrder(packages) {
  const byName = new Map(packages.map(pkg => [pkg.name, pkg]))
  const order = []
  const visit = name => {
    if (order.includes(name) || !byName.has(name)) {
      return
    }
    for (const dep of byName.get(name).deps) {
      visit(dep)
    }
    order.push(name)
  }
  for (const pkg of packages) {
    visit(pkg.name)
  }
  return order
}

function printTable(rows) {
  const widths = rows[0].map((_, column) => Math.max(...rows.map(row => row[column].length)))
  for (const row of rows) {
    print(
      row
        .map((cell, column) => cell.padEnd(widths[column]))
        .join('  ')
        .trimEnd()
    )
  }
}

function baselines() {
  const packages = listPackages()
  const results = packages.map(pkg => ({ pkg, ...checkBaseline(pkg) }))
  const unscoped = name => name.replace('@deepnote/', '')
  printTable([
    ['package', 'status', 'package.json', 'tag', 'npm', 'internal deps'],
    ...results.map(({ pkg, status, tag, npm }) => [
      pkg.name,
      status,
      pkg.version,
      tag?.version ?? 'none',
      npm,
      pkg.deps.map(unscoped).join(' ') || '-',
    ]),
  ])
  print()
  for (const { pkg, status, prereleases, detail } of results) {
    const inFlight = prereleases.length > 0 ? ` (${prereleases.map(({ tag }) => tag).join(', ')})` : ''
    const cause = detail ? `: ${detail}` : ''
    if (status !== 'ok') {
      print(`${pkg.name}: ${status}: ${STATUS_MEANINGS[status]}${cause}${inFlight}`)
    }
  }
  print(`publish order: ${publishOrder(packages).map(unscoped).join(', ')}`)
  return results.every(({ status }) => CONTINUE_STATUSES.has(status))
}

function changes(...names) {
  for (const pkg of selectPackages(names)) {
    const tag = stableTag(pkg.name)
    const paths = [pkg.dir, ...(EXTRA_PATHS[pkg.name] ?? [])]
    print(
      `== ${pkg.name} ${tag ? `since ${tag.version}` : '(never released: whole history)'}; paths: ${paths.join(' ')}`
    )
    const range = tag ? `${tag.tag}..${REF}` : REF
    const log = run('git', [
      'log',
      '--first-parent',
      '--reverse',
      '--format=--- %h %cs %s',
      '--name-only',
      range,
      '--',
      ...paths,
    ])
    print(log.trim() || '(nothing merged)')
    print()
  }
  return true
}

function extract(tarball, into) {
  mkdirSync(into, { recursive: true })
  run('tar', ['-xzf', tarball, '-C', into])
  return path.join(into, 'package')
}

function packedFiles(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .sort()
}

function typesPath(target) {
  if (typeof target === 'string') {
    return /\.d\.[cm]?ts$/.test(target) ? target : undefined
  }
  if (!target || typeof target !== 'object') {
    return undefined
  }
  if (typeof target.types === 'string') {
    return target.types
  }
  for (const condition of Object.values(target)) {
    const found = typesPath(condition)
    if (found) {
      return found
    }
  }
  return undefined
}

function entryPoints(manifest) {
  const exportsField = manifest.exports ?? { '.': { types: manifest.types } }
  const entries = typeof exportsField === 'string' ? { '.': exportsField } : exportsField
  return Object.fromEntries(
    Object.entries(entries).map(([subpath, target]) => [
      subpath,
      { types: typesPath(target), isCode: /\.[cm]?js\b/.test(JSON.stringify(target)) },
    ])
  )
}

// Reads the export forms tsdown's declaration bundler emits; `export * from` can't be enumerated.
function exportNames(file) {
  const source = readFileSync(file, 'utf8')
  const names = new Set()
  for (const [, list] of source.matchAll(/^export (?:type )?\{([^}]*)\}/gm)) {
    for (const item of list.split(',')) {
      const name = item
        .trim()
        .replace(/^type /, '')
        .split(/\s+as\s+/)
        .pop()
      if (name) {
        names.add(name)
      }
    }
  }
  const declaration =
    /^export (?:declare )?(?:abstract )?(?:const|let|var|function|class|interface|type|enum|namespace) (\w+)/gm
  for (const [, name] of source.matchAll(declaration)) {
    names.add(name)
  }
  for (const [, name] of source.matchAll(/^export \* as (\w+) from /gm)) {
    names.add(name)
  }
  if (/^export default /m.test(source)) {
    names.add('default')
  }
  const starExports = [...source.matchAll(/^export \* from ['"]([^'"]+)['"]/gm)].map(([, from]) => from)
  return { names, starExports }
}

function listDiff(prev, next) {
  const removed = [...prev].filter(item => !next.has(item))
  const added = [...next].filter(item => !prev.has(item))
  return `removed: ${removed.join(', ') || 'none'}; added: ${added.join(', ') || 'none'}`
}

function consumerFields(manifest) {
  const fields = {}
  for (const field of CONSUMER_FIELDS) {
    if (field in manifest) {
      fields[field] = manifest[field]
    }
  }
  for (const hook of INSTALL_HOOKS) {
    if (manifest.scripts?.[hook]) {
      fields[`scripts.${hook}`] = manifest.scripts[hook]
    }
  }
  return fields
}

const isPlainObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)
const show = value => (value === undefined ? '(absent)' : JSON.stringify(value))

// Compares objects key by key, so the dependency order `pnpm pack` writes doesn't show up as a change.
function fieldChanges(prev, next) {
  const changed = []
  for (const key of [...new Set([...Object.keys(prev), ...Object.keys(next)])].sort()) {
    const [a, b] = [prev[key], next[key]]
    if (isPlainObject(a) && isPlainObject(b)) {
      for (const sub of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
        if (show(a[sub]) !== show(b[sub])) {
          changed.push(`${key}.${sub}: ${show(a[sub])} -> ${show(b[sub])}`)
        }
      }
    } else if (show(a) !== show(b)) {
      changed.push(`${key}: ${show(a)} -> ${show(b)}`)
    }
  }
  return changed
}

function bundledPackages(root) {
  const found = new Set()
  for (const file of packedFiles(root).filter(name => /\.[cm]?js$/.test(name))) {
    const source = readFileSync(path.join(root, file), 'utf8')
    for (const [, pkg] of source.matchAll(/\/\/#region \S*node_modules\/\.pnpm\/([^/\s]+)/g)) {
      found.add(pkg)
    }
  }
  return found
}

// Packages a declaration file imports. Anchored to statements: JSDoc examples quote `import ... from '...'` too.
function typeImports(file) {
  const imports = /^(?:import|export)\b[^\n]*\bfrom\s*['"]([^'"]+)['"]/gm
  const names = new Set()
  for (const [, specifier] of readFileSync(file, 'utf8').matchAll(imports)) {
    if (specifier.startsWith('.') || isBuiltin(specifier)) {
      continue
    }
    const parts = specifier.split('/')
    names.add(specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0])
  }
  return names
}

// Prints the export names of every entry point; returns the checks that couldn't run and what the types import.
function compareExports(pkg, prev, next) {
  const problems = []
  const imports = { prev: new Set(), next: new Set() }
  const [prevEntries, nextEntries] = [entryPoints(prev.manifest), entryPoints(next.manifest)]

  for (const subpath of [...new Set([...Object.keys(prevEntries), ...Object.keys(nextEntries)])]) {
    const [prevEntry, nextEntry] = [prevEntries[subpath], nextEntries[subpath]]
    if (!prevEntry || !nextEntry) {
      print(`exports ${subpath}: entry ${prevEntry ? 'removed' : 'added'}`)
      continue
    }
    const prevTypes = prevEntry.types && path.join(prev.root, prevEntry.types)
    const nextTypes = nextEntry.types && path.join(next.root, nextEntry.types)
    if (!prevTypes && !nextTypes) {
      if (prevEntry.isCode || nextEntry.isCode) {
        print(`exports ${subpath}: no type declarations; read its source diff`)
      }
      continue
    }
    if (!prevTypes || !nextTypes || !existsSync(prevTypes) || !existsSync(nextTypes)) {
      const declared = `${prevEntry.types ?? 'none'} -> ${nextEntry.types ?? 'none'}`
      problems.push(`${pkg.name} exports ${subpath}: type declarations ${declared}, not both in the tarballs`)
      continue
    }
    const [before, after] = [prevTypes, nextTypes].map(exportNames)
    print(`exports ${subpath}: ${after.names.size} names; ${listDiff(before.names, after.names)}`)
    if (before.names.size === 0 || after.names.size === 0) {
      problems.push(`${pkg.name} exports ${subpath}: no export names parsed from ${nextEntry.types}`)
    }
    for (const from of new Set([...before.starExports, ...after.starExports])) {
      problems.push(`${pkg.name} exports ${subpath}: \`export * from '${from}'\` can't be enumerated`)
    }
    for (const name of typeImports(prevTypes)) {
      imports.prev.add(name)
    }
    for (const name of typeImports(nextTypes)) {
      imports.next.add(name)
    }
  }
  return { problems, imports }
}

// A raised floor on a dependency the public types import can change those types, so it is flagged.
function printTypeImports(pkg, prev, next, imports) {
  const isInternal = name => name.startsWith('@deepnote/')
  const internal = side => [...imports[side]].filter(name => isInternal(name) && name !== pkg.name).sort()
  const [published, current] = [internal('prev').join(', '), internal('next').join(', ')]
  const changed = published === current ? '' : ` (published version: ${published || 'no internal package'})`
  print(`public types reference: ${current || 'no internal package'}${changed}`)

  const range = (manifest, dep) => manifest.dependencies?.[dep] ?? manifest.peerDependencies?.[dep]
  const thirdParty = [...imports.next]
    .filter(name => !isInternal(name))
    .sort()
    .map(dep => {
      const [from, to] = [range(prev.manifest, dep), range(next.manifest, dep)]
      return from === to ? dep : `${dep} (range ${from ?? 'none'} -> ${to ?? 'none'}; diff its declarations)`
    })
  print(`public types import: ${thirdParty.join(', ') || 'no third-party package'}`)
}

// Compares the bytes of every file in both tarballs, with chunk hashes normalized.
function builtFiles(prev, next) {
  const byName = root => new Map(packedFiles(root).map(file => [file.replace(CHUNK_HASH, '-[hash]'), file]))
  const [before, after] = [byName(prev.root), byName(next.root)]
  const common = [...after.keys()].filter(name => before.has(name))
  const differing = common.filter(name => {
    const [a, b] = [path.join(prev.root, before.get(name)), path.join(next.root, after.get(name))]
    return !readFileSync(a).equals(readFileSync(b))
  })
  const version = prev.manifest.version
  const changed = differing.filter(name => name !== 'package.json')
  if (changed.length > 0) {
    const more = changed.length > 10 ? `, and ${changed.length - 10} more` : ''
    return `${changed.length} differ from ${version}: ${changed.slice(0, 10).join(', ')}${more}`
  }
  const sameFiles = common.length === before.size && common.length === after.size
  const manifestNote = differing.includes('package.json') ? ' apart from package.json' : ''
  return `${sameFiles ? '' : 'files in both versions '}identical to ${version}${manifestNote}`
}

function compareSurface(pkg, prevRoot, nextRoot) {
  const [prev, next] = [prevRoot, nextRoot].map(root => ({
    root,
    manifest: JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')),
  }))
  const { problems, imports } = compareExports(pkg, prev, next)
  printTypeImports(pkg, prev, next, imports)

  const manifestChanges = fieldChanges(consumerFields(prev.manifest), consumerFields(next.manifest))
  print(
    `package.json: ${manifestChanges.length > 0 ? `${manifestChanges.length} changes` : 'no consumer-facing change'}`
  )
  for (const change of manifestChanges) {
    print(`  ${change}`)
  }

  const normalized = root => new Set(packedFiles(root).map(file => file.replace(CHUNK_HASH, '-[hash]')))
  print(`packed files: ${listDiff(normalized(prevRoot), normalized(nextRoot))}`)
  print(`built files: ${builtFiles(prev, next)}`)

  const [prevBundled, nextBundled] = [bundledPackages(prevRoot), bundledPackages(nextRoot)]
  const bundled = prevBundled.size + nextBundled.size > 0 ? listDiff(prevBundled, nextBundled) : 'none'
  print(`bundled third-party packages: ${bundled}`)
  return problems
}

function surface(...names) {
  const packages = selectPackages(names)
  const head = run('git', ['rev-parse', '--short', 'HEAD']).trim()
  print(`building the working tree at ${head}`)
  run('pnpm', ['build'], { timeout: 15 * 60 * 1000 })
  const work = mkdtempSync(path.join(tmpdir(), 'bump-surface-'))
  print(`tarballs unpacked under ${work}/{prev,next}/<dir>/package`)
  const problems = []
  for (const pkg of packages) {
    const tag = stableTag(pkg.name)
    if (!tag) {
      print(`\n== ${pkg.name}: never released, nothing to compare`)
      continue
    }
    const [prevDir, nextDir] = ['prev', 'next'].map(side => path.join(work, side, path.basename(pkg.dir)))
    mkdirSync(prevDir, { recursive: true })
    const packArgs = ['pack', `${pkg.name}@${tag.version}`, '--json', '--pack-destination', prevDir, NPM_REGISTRY]
    const [published] = JSON.parse(run('npm', packArgs))
    const packed = JSON.parse(run('pnpm', ['pack', '--json', '--pack-destination', nextDir], { cwd: pkg.dir }))
    print(`\n== ${pkg.name}: ${tag.version} on npm -> working tree`)
    problems.push(
      ...compareSurface(
        pkg,
        extract(path.join(prevDir, published.filename), prevDir),
        extract(packed.filename, nextDir)
      )
    )
  }
  for (const problem of problems) {
    print(`\nCHECK FAILED: ${problem}; compare by hand`)
  }
  return problems.length === 0
}

function setVersion(name, version) {
  if (!name || !parseVersion(version) || parseVersion(version).prerelease) {
    fail('usage: set-version <@deepnote/name> <X.Y.Z>')
  }
  const [pkg] = selectPackages([name])
  const tag = stableTag(name)
  if (tag && compareVersions(version, tag.version) <= 0) {
    fail(`${name}@${version} is not above the last release, ${tag.version}`)
  }
  if (npmView(`${name}@${version}`, 'version') !== null) {
    fail(`${name}@${version} is already on npm`)
  }
  if (remoteTagExists(`${name}@${version}`)) {
    fail(`tag ${name}@${version} already exists on origin`)
  }
  const manifestPath = path.join(pkg.dir, 'package.json')
  if (JSON.parse(readFileSync(manifestPath, 'utf8')).version === version) {
    print(`${name} is already at ${version}`)
    return true
  }
  // Release tags come only from GitHub releases, so pnpm must not commit or tag.
  run('pnpm', ['version', version, '--no-git-tag-version'], { cwd: pkg.dir })
  const numstat = run('git', ['diff', '--numstat', '--', manifestPath]).trim()
  if (numstat !== `1\t1\t${manifestPath}`) {
    fail(`expected a one-line change in ${manifestPath}, got: ${numstat}`)
  }
  // Workspace dependencies are link: entries without versions, so a bump never touches the lockfile.
  if (exitStatus('git', ['diff', '--quiet', '--', 'pnpm-lock.yaml'], [1]) !== 0) {
    fail('pnpm-lock.yaml changed')
  }
  print(`${name}: ${version}`)
  return true
}

const commands = { baselines, changes, surface, 'set-version': setVersion }
const [command, ...args] = process.argv.slice(2)
if (!Object.hasOwn(commands, command)) {
  process.stderr.write(`usage: bump.mjs <${Object.keys(commands).join('|')}> [args]\n`)
  process.exit(2)
}
process.chdir(run('git', ['rev-parse', '--show-toplevel']).trim())
try {
  process.exitCode = commands[command](...args) ? 0 : 1
} catch (error) {
  const output = error.stdout?.trim().split('\n').slice(-40).join('\n')
  process.stderr.write(`${error.message}\n${output ? `${output}\n` : ''}`)
  process.exitCode = 1
}
