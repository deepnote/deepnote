/**
 * What a project installs, and whether it will install the same thing tomorrow.
 *
 * A notebook is only reproducible as far as its dependencies are. `pandas>=2.0` resolved to 2.0.1
 * the day it was written and resolves to something else now, so a notebook that ran then and fails
 * now has no diff to blame — which is the specific failure mode that makes people stop trusting a
 * workspace. This module recovers the dependency set from the three places a `.deepnote` project can
 * declare one, and reports how firmly each is held.
 *
 *   environment.packages          the resolved lockfile sync writes — name → version
 *   project.settings.requirements the declared requirements, PEP 508 strings
 *   `!pip install …` in a block   an imperative install, re-run on every execution
 *
 * The third is the interesting one. It is not in any inventory built from the project file, it runs
 * every time the notebook does, and it is usually how a dependency enters a workspace without
 * anybody deciding to add it.
 *
 * Nothing here resolves anything. There is no index lookup and no network: a name and a specifier
 * as written are all that is needed to answer "is this pinned", and answering it offline is what
 * lets the check run in CI next to the rest of `lint --governance`.
 */

import type { DeepnoteBlock } from '@deepnote/blocks'

/** How firmly a requirement is held. */
export type PinState =
  /** An exact version: `==2.0.1`, or a VCS reference at a commit. Reproducible. */
  | 'pinned'
  /** A range: `>=2.0`, `~=2.0`, `!=1.9`. Resolves to whatever is newest at install time. */
  | 'ranged'
  /** No version at all. */
  | 'unpinned'

/** Where a requirement was declared. */
export type RequirementSource =
  /** `environment.packages` — the resolved set, written by sync. */
  | 'environment'
  /** `project.settings.requirements` — what the project asked for. */
  | 'requirements'
  /** A `!pip install` line inside a code block. */
  | 'install-command'

export interface PackageRequirement {
  /** Normalised name, per PEP 503: lower-cased with runs of `-`, `_` and `.` folded to `-`. */
  name: string
  /** The name as written, which is what a reader will search the notebook for. */
  rawName: string
  /** The version specifier as written, when there is one. */
  specifier?: string
  /** The exact version, when the requirement is pinned to one. */
  version?: string
  pin: PinState
  source: RequirementSource
  /** The installer, for an install command: `pip`, `uv`, `conda`. */
  installer?: string
  /** Block the install command was found in. */
  blockId?: string
  /** One-based line within that block. */
  line?: number
}

/**
 * Installers whose `install` subcommand introduces requirements.
 *
 * `conda` is included because its spelling differs in a way that matters: `conda install numpy=1.21`
 * pins with a single `=`, which under pip's grammar would not be a specifier at all.
 */
const INSTALL_COMMAND =
  /^\s*[!%]+\s*(?:(?:python[0-9.]*|py)\s+-m\s+)?(pip[0-9]*|uv|conda|mamba|micromamba|poetry)\s+(?:pip\s+)?(?:add|install)\s+(.*)$/

/** Flags that take a value, so the value is not mistaken for a package name. */
const FLAGS_WITH_VALUES = new Set([
  '-r',
  '--requirement',
  '-c',
  '--constraint',
  '-i',
  '--index-url',
  '--extra-index-url',
  '-f',
  '--find-links',
  '-t',
  '--target',
  '--python',
  '-n',
  '--name',
  '-e',
  '--editable',
  '--prefix',
])

/** Normalise a distribution name so `Foo_Bar` and `foo-bar` are one package (PEP 503). */
export function normalizePackageName(name: string): string {
  return name.replace(/[-_.]+/g, '-').toLowerCase()
}

/** A 7+ character hex string — a commit a VCS requirement can be pinned to. */
const COMMIT_REF = /@[0-9a-f]{7,40}(?:$|#)/i

/**
 * Parse one requirement string into a name, a specifier and how firmly it is pinned.
 *
 * Returns `undefined` for anything that is not a requirement: a bare flag, an index URL, a `-r`
 * include. Those are not dependencies, and reporting them as unpinned ones would be noise.
 */
export function parseRequirement(
  input: string,
  options: { source: RequirementSource; installer?: string } = { source: 'requirements' }
): PackageRequirement | undefined {
  // Strip a trailing comment and an environment marker: neither affects what gets installed.
  let text = input.split(/\s+#/)[0].split(';')[0].trim()
  if (text === '' || text.startsWith('#') || text.startsWith('-')) {
    return undefined
  }

  // A direct reference: `name @ https://…`, or a bare VCS or archive URL.
  if (text.includes('://') || text.startsWith('git+')) {
    const at = text.indexOf('@')
    const rawName = at > 0 && !text.slice(0, at).includes(':') ? text.slice(0, at).trim() : urlProjectName(text)
    if (!rawName) {
      return undefined
    }
    return {
      name: normalizePackageName(rawName),
      rawName,
      specifier: text,
      // A URL is only reproducible when it names a commit. A branch moves; so does `main`.
      pin: COMMIT_REF.test(text) ? 'pinned' : 'unpinned',
      source: options.source,
      ...(options.installer ? { installer: options.installer } : {}),
    }
  }

  // `conda install numpy=1.21` pins with a single `=`; pip would read that as no specifier at all.
  const isConda = options.installer === 'conda' || options.installer === 'mamba' || options.installer === 'micromamba'
  if (isConda && /^[A-Za-z0-9][A-Za-z0-9._-]*=[^=]/.test(text)) {
    text = text.replace('=', '==')
  }

  const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$/.exec(text)
  if (!match) {
    return undefined
  }
  const [, rawName, , rest] = match
  const specifier = rest.trim()

  return {
    name: normalizePackageName(rawName),
    rawName,
    ...(specifier ? { specifier } : {}),
    ...pinOf(specifier),
    source: options.source,
    ...(options.installer ? { installer: options.installer } : {}),
  }
}

/** The project name inside a URL requirement, best-effort — only used as a label. */
function urlProjectName(url: string): string | undefined {
  const tail = url
    .split(/[#?]/)[0]
    .replace(/\.git$/, '')
    .split('/')
    .pop()
  return tail && /[A-Za-z]/.test(tail) ? tail.split('@')[0] : undefined
}

/** Classify a specifier, and recover the exact version when there is one. */
function pinOf(specifier: string): { pin: PinState; version?: string } {
  if (specifier === '') {
    return { pin: 'unpinned' }
  }
  // `==2.0.1` or `===2.0.1`, and only when it is the whole specifier: `==2.*` is a range, and
  // `>=2,==2.1` is contradictory enough that calling it pinned would be generous.
  const exact = /^={2,3}\s*([^\s,*]+)$/.exec(specifier)
  if (exact) {
    return { pin: 'pinned', version: exact[1] }
  }
  return { pin: 'ranged' }
}

/** Split an install command's arguments, honouring quotes around `"pandas>=2.0"`. */
function splitArguments(text: string): string[] {
  return (text.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(argument => argument.replace(/^["']|["']$/g, ''))
}

/** Requirements installed by `!pip install` lines inside one block's content. */
export function findInstallCommands(content: string, blockId?: string): PackageRequirement[] {
  const requirements: PackageRequirement[] = []

  content.split('\n').forEach((text, index) => {
    const match = INSTALL_COMMAND.exec(text)
    if (!match) {
      return
    }
    const installer = match[1].startsWith('pip') ? 'pip' : match[1]
    const argumentList = splitArguments(match[2])

    for (let i = 0; i < argumentList.length; i++) {
      const argument = argumentList[i]
      if (FLAGS_WITH_VALUES.has(argument)) {
        i++
        continue
      }
      const requirement = parseRequirement(argument, { source: 'install-command', installer })
      if (requirement) {
        requirements.push({ ...requirement, ...(blockId ? { blockId } : {}), line: index + 1 })
      }
    }
  })

  return requirements
}

/** The declared environment of a project, as much of it as these checks read. */
export interface ProjectEnvironment {
  /** `environment.packages`: the resolved set, name → version. */
  packages?: Record<string, string>
  /** `project.settings.requirements`: PEP 508 strings. */
  requirements?: string[]
}

export interface DependencySet {
  /** Every requirement found, in declaration order: environment, then requirements, then installs. */
  requirements: PackageRequirement[]
  /** Normalised names declared in `environment.packages` — the tracked set. */
  tracked: Set<string>
  /** Whether the project declares an environment at all, which decides what "untracked" can mean. */
  hasEnvironment: boolean
}

/** Blocks that can carry an install command. */
const INSTALLABLE_BLOCK_TYPES = new Set(['code', 'notebook-function'])

/**
 * Collect everything one project installs.
 *
 * Order matters for the report rather than the result: `environment.packages` is the resolved truth
 * when sync wrote one, and the other two are what the project asked for.
 */
export function collectDependencies(
  environment: ProjectEnvironment | undefined,
  blocks: DeepnoteBlock[]
): DependencySet {
  const requirements: PackageRequirement[] = []
  const tracked = new Set<string>()

  for (const [rawName, version] of Object.entries(environment?.packages ?? {})) {
    const name = normalizePackageName(rawName)
    tracked.add(name)
    requirements.push({
      name,
      rawName,
      ...(version ? { specifier: `==${version}`, version } : {}),
      // A lockfile entry with no version is not a lock. Sync always writes one, so this is only
      // reachable for a hand-edited file — but a hand-edited file is exactly where it matters.
      pin: version ? 'pinned' : 'unpinned',
      source: 'environment',
    })
  }

  for (const declared of environment?.requirements ?? []) {
    const requirement = parseRequirement(declared, { source: 'requirements' })
    if (requirement) {
      requirements.push(requirement)
    }
  }

  for (const block of blocks) {
    if (!INSTALLABLE_BLOCK_TYPES.has(block.type)) {
      continue
    }
    const content =
      typeof (block as { content?: unknown }).content === 'string' ? (block as { content: string }).content : ''
    requirements.push(...findInstallCommands(content, block.id))
  }

  return {
    requirements,
    tracked,
    hasEnvironment: Object.keys(environment?.packages ?? {}).length > 0,
  }
}

/**
 * One package as the report sees it, after the three sources are reconciled.
 *
 * Which declaration decides reproducibility is the whole question here, and it is not simply the
 * weakest one. `environment.packages` is a **resolved lockfile**: when it names a version, that is
 * what gets installed, and a looser `requirements` entry alongside it is what was asked for rather
 * than what arrives. Treating `numpy>=1.24` as unreproducible when the lock pins 1.26.0 would fire
 * on almost every synced project and be wrong every time.
 *
 * The exception is an imperative install. `!pip install seaborn` runs when the notebook runs, after
 * the environment is built, so it overrides the lock — a locked package that a block also installs
 * loosely is not reproducible, and that case is the reason this is not a one-line rule.
 */
export interface PackageEntry {
  name: string
  rawName: string
  /** Exact versions seen for this package, sorted. Usually one. */
  versions: string[]
  /** How firmly the package is actually held, once the lockfile and any install command are weighed. */
  pin: PinState
  /** Every source it was declared in. */
  sources: RequirementSource[]
  /** The declaration responsible for `pin`, when the package is not pinned. */
  weakestSource?: RequirementSource
  /** Specifier of that declaration, which is the one worth printing. */
  specifier?: string
  /** First install command that introduced it, when one did. */
  blockId?: string
  line?: number
}

const PIN_RANK: Record<PinState, number> = { pinned: 2, ranged: 1, unpinned: 0 }

/**
 * Reconcile a project's requirements into one entry per package.
 *
 * See `PackageEntry` for why the lockfile wins over a looser sibling declaration, and why an
 * install command still beats the lockfile.
 */
export function reconcile(requirements: PackageRequirement[]): PackageEntry[] {
  const grouped = new Map<string, PackageRequirement[]>()
  for (const requirement of requirements) {
    grouped.set(requirement.name, [...(grouped.get(requirement.name) ?? []), requirement])
  }

  const entries: PackageEntry[] = []
  for (const [name, declarations] of grouped) {
    const versions = [
      ...new Set(declarations.map(d => d.version).filter((version): version is string => version !== undefined)),
    ].sort()
    const locked = declarations.some(d => d.source === 'environment' && d.version !== undefined)

    // The lock settles everything except what a block re-installs at run time.
    const deciding = locked
      ? declarations.filter(d => d.source === 'install-command')
      : declarations.filter(d => d.source !== 'environment' || d.pin !== 'pinned')
    const weakest = deciding.reduce<PackageRequirement | undefined>(
      (lowest, candidate) => (!lowest || PIN_RANK[candidate.pin] < PIN_RANK[lowest.pin] ? candidate : lowest),
      undefined
    )
    const pin: PinState = !weakest || weakest.pin === 'pinned' ? 'pinned' : weakest.pin
    const install = declarations.find(d => d.blockId !== undefined)

    entries.push({
      name,
      rawName: declarations[0].rawName,
      versions,
      pin,
      sources: [...new Set(declarations.map(d => d.source))],
      ...(pin !== 'pinned' && weakest
        ? {
            weakestSource: weakest.source,
            ...(weakest.specifier ? { specifier: weakest.specifier } : {}),
          }
        : {}),
      ...(install?.blockId ? { blockId: install.blockId } : {}),
      ...(install?.line ? { line: install.line } : {}),
    })
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name))
}

/** A PyPI package URL, the identifier an SBOM consumer matches advisories against. */
export function packageUrl(name: string, version?: string): string {
  return version ? `pkg:pypi/${name}@${version}` : `pkg:pypi/${name}`
}
