// Build a local-only copy of the app notebook that a local kernel can run end to end.
//
// In Deepnote, a notebook-function (module) block asks the Deepnote backend to run another notebook
// and hands back its exports. A local kernel has no backend to ask, so this script replaces each
// module block with a code block that runs the module notebook's code in a private namespace and
// binds the same exports. Everything else, including every block id and all app layout metadata, is
// copied unchanged. The shipped `.deepnote` file is never modified.
import { readFileSync, writeFileSync } from 'node:fs'
// In a real project: `import { ... } from '@deepnote/blocks'`.
import { deserializeDeepnoteFile, serializeDeepnoteFile } from '../../../packages/blocks/dist/index.js'

/**
 * Turn a module notebook into Python that defines its exports in `__exports`.
 * An exported block's value is its last line, the same rule Deepnote applies to code-block exports.
 */
function moduleSource(notebook) {
  const parts = []
  for (const block of notebook.blocks) {
    if (block.type === 'markdown' || block.type.startsWith('text-cell')) continue
    if (block.type !== 'code') {
      throw new Error(`Preview cannot inline a "${block.type}" block from module "${notebook.name}"`)
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
    `# Local preview stand-in for the "${target.name}" module block.`,
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
    metadata: { ...block.metadata, deepnote_preview_module: target.name },
  }
}

/**
 * @param {string} sourcePath the shipped project file
 * @param {string} outPath where to write the preview notebook
 * @param {{ appNotebook: string, agentModel?: string }} options
 */
export function buildPreview(sourcePath, outPath, { appNotebook, agentModel }) {
  const file = deserializeDeepnoteFile(readFileSync(sourcePath, 'utf8'))
  const app = file.project.notebooks.find(nb => nb.name === appNotebook)
  if (!app) throw new Error(`No notebook named "${appNotebook}" in ${sourcePath}`)
  const modules = new Map(file.project.notebooks.filter(nb => nb.isModule).map(nb => [nb.id, nb]))

  const blocks = app.blocks.map(block => {
    if (block.type === 'notebook-function') return standInFor(block, modules)
    if (block.type === 'agent' && agentModel) {
      return { ...block, metadata: { ...block.metadata, deepnote_agent_model: agentModel } }
    }
    return block
  })

  const preview = { ...file, project: { ...file.project, notebooks: [{ ...app, blocks }] } }
  writeFileSync(outPath, serializeDeepnoteFile(preview))
  return { notebookId: app.id, projectId: file.project.id, projectName: file.project.name }
}
