import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { serializeDeepnoteFile } from '@deepnote/blocks'

/** Builds a minimal native `.deepnote` file, optionally declaring an init notebook / integrations / settings. */
export function makeDeepnoteFile(args: {
  projectId: string
  initNotebookId?: string
  notebooks: Array<{ id: string; name: string; blockIds: string[] }>
  integrations?: Array<{ id: string; name: string; type: string }>
  settings?: Record<string, unknown>
}): DeepnoteFile {
  return {
    version: '1.0.0',
    metadata: { createdAt: '2025-01-01T00:00:00Z' },
    project: {
      id: args.projectId,
      name: 'Test Project',
      ...(args.initNotebookId !== undefined ? { initNotebookId: args.initNotebookId } : {}),
      ...(args.integrations !== undefined ? { integrations: args.integrations } : {}),
      ...(args.settings !== undefined ? { settings: args.settings } : {}),
      notebooks: args.notebooks.map(nb => ({
        id: nb.id,
        name: nb.name,
        blocks: nb.blockIds.map((blockId, i) => ({
          id: blockId,
          type: 'code' as const,
          blockGroup: `bg-${blockId}`,
          sortingKey: `00${i}`,
          content: `# ${blockId}`,
          metadata: {},
        })),
      })),
    },
  }
}

/**
 * Writes a main `.deepnote` (declaring a sibling init) plus an init-only sibling `.deepnote`
 * to `dir`, returning the path to the main file. The sibling's integrations/settings can be made
 * to diverge from the main file's so the init resolver emits warnings.
 */
export async function writeMainWithDivergingInitSibling(
  dir: string,
  options: {
    mainIntegrations?: Array<{ id: string; name: string; type: string }>
    initIntegrations?: Array<{ id: string; name: string; type: string }>
    mainSettings?: Record<string, unknown>
    initSettings?: Record<string, unknown>
  } = {}
): Promise<string> {
  const initSibling = makeDeepnoteFile({
    projectId: 'proj-1',
    initNotebookId: 'nb-init',
    notebooks: [{ id: 'nb-init', name: 'Init', blockIds: ['init-b1'] }],
    integrations: options.initIntegrations,
    settings: options.initSettings,
  })
  const mainFile = makeDeepnoteFile({
    projectId: 'proj-1',
    initNotebookId: 'nb-init',
    notebooks: [{ id: 'nb-main', name: 'Main', blockIds: ['main-b1'] }],
    integrations: options.mainIntegrations,
    settings: options.mainSettings,
  })

  const initPath = path.join(dir, 'project-init.deepnote')
  const mainPath = path.join(dir, 'project-main.deepnote')
  await fs.writeFile(initPath, serializeDeepnoteFile(initSibling), 'utf-8')
  await fs.writeFile(mainPath, serializeDeepnoteFile(mainFile), 'utf-8')
  return mainPath
}
