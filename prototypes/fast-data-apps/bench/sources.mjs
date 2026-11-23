// Data sources for the studio: named local snapshot files, optionally with the notebook that
// produces them. Snapshots are read from disk on every request; running a notebook refreshes
// its snapshot file.
//
// sources.json: [{ name, snapshot, notebook?, inputs?, outputFile? }]
//   snapshot   path to a merged-outputs .json file or a .snapshot.deepnote file
//   notebook   path to the .deepnote notebook that produces it (enables "Run notebooks")
//   inputs     input values for the run
//   outputFile a file the notebook writes (relative to the notebook) to use instead of its JSON outputs
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getEnvironmentVariablesForIntegrations } from '../../../packages/database-integrations/dist/index.js'
import { parseSnapshot, runWithInputs } from '../../../packages/local-runner/dist/index.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = join(root, 'sources.json')
const requireFromRunner = createRequire(join(root, '../../packages/database-integrations/package.json'))
const YAML = requireFromRunner('yaml')

export const resolvePath = p => (isAbsolute(p) ? p : join(root, p))

export function loadConfig() {
  return existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, 'utf8')) : []
}

export function saveConfig(sources) {
  const clean = sources
    .filter(s => s.name && s.snapshot)
    .map(({ name, snapshot, notebook, inputs, outputFile }) => ({
      name: String(name).replace(/\W+/g, '_'),
      snapshot,
      ...(notebook ? { notebook } : {}),
      ...(inputs && Object.keys(inputs).length ? { inputs } : {}),
      ...(outputFile ? { outputFile } : {}),
    }))
  writeFileSync(CONFIG, `${JSON.stringify(clean, null, 2)}\n`)
  return clean
}

/** Config plus what is on disk: whether each file exists and when the snapshot last changed. */
export function describeConfig() {
  return loadConfig().map(s => {
    const snap = resolvePath(s.snapshot)
    const nb = s.notebook ? resolvePath(s.notebook) : null
    return {
      ...s,
      snapshotExists: existsSync(snap),
      snapshotUpdated: existsSync(snap) ? statSync(snap).mtime.toISOString() : null,
      notebookExists: nb ? existsSync(nb) : false,
    }
  })
}

/** Merge a run's application/json outputs into one object, the way a data app reads them. */
function mergeJsonOutputs(blocks) {
  const outputs = blocks.flatMap(b => b.outputs ?? [])
  return Object.assign({}, ...outputs.map(o => o.data?.['application/json']).filter(Boolean))
}

/** Read one snapshot file from disk (merged .json, or a .snapshot.deepnote / .deepnote YAML). */
export function readSnapshot(path) {
  const file = resolvePath(path)
  const text = readFileSync(file, 'utf8')
  if (/\.json$/i.test(file)) return JSON.parse(text)
  const view = parseSnapshot(text)
  return mergeJsonOutputs(view.notebooks.flatMap(n => n.blocks))
}

/** The selected sources' snapshots, read now, keyed by source name. */
export function readSelected(names) {
  const config = loadConfig()
  const chosen = names?.length ? config.filter(s => names.includes(s.name)) : config
  return Object.fromEntries(chosen.map(s => [s.name, readSnapshot(s.snapshot)]))
}

/** Integrations from a .deepnote.env.yaml next to the notebook, as the CLI does. */
function integrationEnv(notebookPath) {
  const envFile = join(dirname(notebookPath), '.deepnote.env.yaml')
  if (!existsSync(envFile)) return
  const integrations = YAML.parse(readFileSync(envFile, 'utf8'))?.integrations ?? []
  for (const { name, value } of getEnvironmentVariablesForIntegrations(integrations, {
    projectRootDirectory: dirname(notebookPath),
  }).envVars)
    process.env[name] = value
}

/**
 * Run a source's notebook for real and write the fresh result to its snapshot file.
 * Returns { ms, keys }.
 */
/** Run a source's notebook with the given inputs and return its data (nothing written). */
async function runNotebook(source, inputs) {
  if (!source.notebook) throw new Error(`${source.name} has no notebook`)
  const notebook = resolvePath(source.notebook)
  integrationEnv(notebook)
  const result = await runWithInputs(notebook, inputs, { persistSnapshot: false, cwd: dirname(notebook) })
  // A block can fail after the data is out (e.g. an optional AI note without a model key): keep
  // the data and report the error as a warning. Only a run that produced no data fails.
  const error = (result.outputs ?? []).flatMap(b => b.outputs ?? []).find(o => o.output_type === 'error')
  const data = source.outputFile
    ? JSON.parse(readFileSync(join(dirname(notebook), source.outputFile), 'utf8'))
    : mergeJsonOutputs(result.outputs ?? [])
  if (!Object.keys(data).length)
    throw new Error(error ? `${error.ename}: ${error.evalue}` : 'the notebook produced no JSON output')
  return { data, result, warning: error ? `${error.ename}: ${error.evalue}`.slice(0, 200) : null }
}

/**
 * Run a source's notebook for real and write the fresh result to its snapshot file.
 * Returns { ms, keys, warning }.
 */
export async function runSource(source) {
  const t0 = performance.now()
  const { data, result, warning } = await runNotebook(source, source.inputs ?? {})
  const target = resolvePath(source.snapshot)
  if (/\.json$/i.test(target)) writeFileSync(target, JSON.stringify(data, null, 1))
  else writeFileSync(target, result.snapshotYaml)
  rmSync(cacheDir(source), { recursive: true, force: true }) // fresh data: per-input results are stale
  return { ms: performance.now() - t0, keys: Object.keys(data), warning }
}

// ---------- per-input snapshots (filters bound to notebook inputs) ----------

const cacheDir = source => join(root, 'snapshots', '.cache', source.name)
const cacheKey = inputs =>
  createHash('sha1')
    .update(JSON.stringify(Object.entries(inputs).sort()))
    .digest('hex')
    .slice(0, 16)

/**
 * The source's output for these inputs: its default snapshot when the inputs are the defaults,
 * else a cached run, else a fresh run (cached for next time). Returns { data, cached, ms }.
 */
export async function snapshotFor(source, overrides) {
  const inputs = { ...(source.inputs ?? {}), ...overrides }
  if (JSON.stringify(Object.entries(inputs).sort()) === JSON.stringify(Object.entries(source.inputs ?? {}).sort()))
    return { data: readSnapshot(source.snapshot), cached: true, ms: 0 }
  const file = join(cacheDir(source), `${cacheKey(inputs)}.json`)
  if (existsSync(file)) return { data: JSON.parse(readFileSync(file, 'utf8')), cached: true, ms: 0 }
  const t0 = performance.now()
  const { data } = await runNotebook(source, inputs)
  mkdirSync(cacheDir(source), { recursive: true })
  writeFileSync(file, JSON.stringify(data))
  return { data, cached: false, ms: performance.now() - t0 }
}

export const hasCached = (source, overrides) =>
  existsSync(join(cacheDir(source), `${cacheKey({ ...(source.inputs ?? {}), ...overrides })}.json`))
