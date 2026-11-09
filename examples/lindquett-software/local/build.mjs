// Build a local-only copy of a use case's notebook that a local kernel can run end to end.
//
// In Deepnote, a module block asks the Deepnote backend to run a module notebook, here one in the shared
// "Lindquett metrics" project, and hands back its exports. A local kernel has no backend to ask, so this
// replaces each module block with a code block that runs the module notebook's code in a private
// namespace and binds the same exports. Everything else, including every block ID, is copied unchanged.
// The shipped `.deepnote` files are never modified.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// In a real project: `import { ... } from '@deepnote/blocks'`.
import { deserializeDeepnoteFile, serializeDeepnoteFile } from '../../../packages/blocks/dist/index.js'

// SQL blocks in these notebooks query data frames. Deepnote Cloud provides that connection; a local
// run reads it from `.deepnote.env.yaml` next to the notebook.
export const LOCAL_INTEGRATIONS = [
  { id: 'deepnote-dataframe-sql', name: 'DataFrame SQL', type: 'pandas-dataframe', metadata: {} },
]
const LOCAL_INTEGRATIONS_YAML = `integrations:
  - id: deepnote-dataframe-sql
    name: DataFrame SQL
    type: pandas-dataframe
    metadata: {}
`

/**
 * Turn a module notebook into Python that defines its exports in `__exports`.
 * An exported block's value is its last line, the same rule Deepnote applies to code-block exports.
 */
function moduleSource(notebook) {
  const parts = []
  for (const block of notebook.blocks) {
    if (block.type === 'markdown' || block.type.startsWith('text-cell')) continue
    if (block.type !== 'code') {
      throw new Error(`Cannot run a "${block.type}" block from module "${notebook.name}" locally`)
    }
    const exportName = block.metadata?.function_export_name
    if (!exportName) {
      parts.push(block.content)
      continue
    }
    const lines = block.content.trimEnd().split('\n')
    const last = lines.pop()
    parts.push([...lines, `__exports[${JSON.stringify(exportName)}] = ${last}`].join('\n'))
  }
  return parts.join('\n\n')
}

function standInFor(block, modules) {
  const target = modules.get(block.metadata.function_notebook_id)
  if (!target) {
    throw new Error(`Module block ${block.id} points at unknown notebook ${block.metadata.function_notebook_id}`)
  }
  const mappings = Object.entries(block.metadata.function_notebook_export_mappings ?? {}).filter(
    ([, mapping]) => mapping.enabled
  )
  const source = moduleSource(target)
  const binds = mappings.map(
    ([name, mapping]) => `${mapping.variable_name} = __ns["__exports"][${JSON.stringify(name)}]`
  )
  const content = [
    `# Local stand-in for the "${target.name}" module block.`,
    '# In Deepnote this block runs the module notebook on the backend and returns its exports.',
    `__ns = {"__exports": {}, "__name__": "deepnote_module"}`,
    `exec(compile(${JSON.stringify(source)}, ${JSON.stringify(`<module ${target.name}>`)}, "exec"), __ns)`,
    ...binds,
    'del __ns',
  ].join('\n')
  return {
    id: block.id,
    blockGroup: block.blockGroup,
    sortingKey: block.sortingKey,
    type: 'code',
    content,
    metadata: { ...block.metadata, deepnote_local_module: target.name },
  }
}

const exampleRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const METRICS_PATH = join(exampleRoot, 'metrics', 'lindquett-metrics.deepnote')

/** The use cases, by folder name, and the notebook file each one ships. */
export const USE_CASES = {
  'revenue-review': 'revenue-review.deepnote',
  'deal-desk': 'deal-desk.deepnote',
  'account-health': 'account-health.deepnote',
  'data-health': 'data-health.deepnote',
  'pricing-planner': 'pricing-baseline.deepnote',
}

/** Path of a use case's shipped notebook file. Throws, listing the use cases, for an unknown name. */
export function useCasePath(useCase) {
  const file = USE_CASES[useCase]
  if (!file) {
    throw new Error(`No use case named "${useCase}". Choose one of ${Object.keys(USE_CASES).join(', ')}.`)
  }
  return join(exampleRoot, useCase, file)
}

/**
 * Write a use case's notebook with its module blocks replaced, plus the `.deepnote.env.yaml` its SQL
 * blocks need, to `<outDir>/<use case>.deepnote`, and return that path.
 *
 * @param {string} useCase folder name, such as `deal-desk`
 * @param {string} outDir directory for the local copy
 * @param {{ agentModel?: string }} [options]
 */
export function buildLocal(useCase, outDir, { agentModel } = {}) {
  const file = deserializeDeepnoteFile(readFileSync(useCasePath(useCase), 'utf8'))
  const [target] = file.project.notebooks
  const metrics = deserializeDeepnoteFile(readFileSync(METRICS_PATH, 'utf8'))
  const modules = new Map(metrics.project.notebooks.filter(nb => nb.isModule).map(nb => [nb.id, nb]))

  const blocks = target.blocks.map(block => {
    if (block.type === 'notebook-function') return standInFor(block, modules)
    if (block.type === 'agent' && agentModel) {
      return { ...block, metadata: { ...block.metadata, deepnote_agent_model: agentModel } }
    }
    return block
  })

  const local = { ...file, project: { ...file.project, notebooks: [{ ...target, blocks }] } }
  mkdirSync(outDir, { recursive: true })
  const outPath = join(outDir, `${useCase}.deepnote`)
  writeFileSync(outPath, serializeDeepnoteFile(local))
  writeFileSync(join(outDir, '.deepnote.env.yaml'), LOCAL_INTEGRATIONS_YAML)
  return outPath
}

/**
 * Assemble the directory `deepnote publish` uploads for a use case's data app: its `app/` page plus the
 * shared client, helpers and styles. The local preview serves the same directory, so what you try is
 * what you publish.
 *
 * @returns {string} the directory
 */
export function buildSite(useCase, outDir) {
  useCasePath(useCase)
  const site = join(outDir, 'site')
  rmSync(site, { recursive: true, force: true })
  cpSync(join(exampleRoot, useCase, 'app'), site, { recursive: true })
  cpSync(join(exampleRoot, 'shared'), site, { recursive: true })
  return site
}
