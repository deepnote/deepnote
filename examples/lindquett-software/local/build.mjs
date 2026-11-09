// Build a local-only copy of one notebook that a local kernel can run end to end.
//
// In Deepnote, a module block asks the Deepnote backend to run another notebook and hands back its
// exports. A local kernel has no backend to ask, so this script replaces each module block with a
// code block that runs the module notebook's code in a private namespace and binds the same exports.
// Everything else, including every block id and all app layout metadata, is copied unchanged. The
// shipped `.deepnote` file is never modified.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
// In a real project: `import { ... } from '@deepnote/blocks'`.
import { deserializeDeepnoteFile, serializeDeepnoteFile } from '../../../packages/blocks/dist/index.js'

// SQL blocks in this project query data frames. Deepnote Cloud provides that connection; a local
// run reads it from `.deepnote.env.yaml` next to the notebook.
const LOCAL_INTEGRATIONS = `integrations:
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

/**
 * Write a single-notebook project file with its module blocks replaced, plus the
 * `.deepnote.env.yaml` its SQL blocks need, into the directory of `outPath`.
 *
 * @param {string} sourcePath the shipped project file
 * @param {string} outPath where to write the local notebook
 * @param {{ notebook: string, agentModel?: string }} options
 */
export function buildLocal(sourcePath, outPath, { notebook, agentModel }) {
  const file = deserializeDeepnoteFile(readFileSync(sourcePath, 'utf8'))
  const target = file.project.notebooks.find(nb => nb.name === notebook)
  if (!target) {
    const names = file.project.notebooks.filter(nb => !nb.isModule).map(nb => `"${nb.name}"`)
    throw new Error(`No notebook named "${notebook}". Choose one of ${names.join(', ')}.`)
  }
  const modules = new Map(file.project.notebooks.filter(nb => nb.isModule).map(nb => [nb.id, nb]))

  const blocks = target.blocks.map(block => {
    if (block.type === 'notebook-function') return standInFor(block, modules)
    if (block.type === 'agent' && agentModel) {
      return { ...block, metadata: { ...block.metadata, deepnote_agent_model: agentModel } }
    }
    return block
  })

  const local = { ...file, project: { ...file.project, notebooks: [{ ...target, blocks }] } }
  writeFileSync(outPath, serializeDeepnoteFile(local))
  writeFileSync(join(dirname(outPath), '.deepnote.env.yaml'), LOCAL_INTEGRATIONS)
  return { notebookId: target.id, projectId: file.project.id, projectName: file.project.name }
}
