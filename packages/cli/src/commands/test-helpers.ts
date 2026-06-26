import fs from 'node:fs/promises'
import os from 'node:os'
import { dirname, join } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { serializeDeepnoteFile } from '@deepnote/blocks'

/**
 * Create a temporary .deepnote file with the given content.
 * Returns the absolute path to the created file.
 */
export async function createTempFile(content: string, prefix = 'deepnote-test-'): Promise<string> {
  const tempDir = await fs.mkdtemp(join(os.tmpdir(), prefix))
  const filePath = join(tempDir, 'test.deepnote')
  await fs.writeFile(filePath, content, 'utf8')
  return filePath
}

/**
 * Clean up a temporary file and its parent directory.
 * Silently ignores errors (best-effort cleanup).
 */
export async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath)
    await fs.rmdir(dirname(filePath))
  } catch {
    // Ignore cleanup errors
  }
}

export interface SplitWithSiblingInitFixture {
  /** Absolute path to the split "main" .deepnote file (the one analysis commands receive). */
  mainPath: string
  /** Absolute path to the sibling single-notebook init .deepnote file. */
  initPath: string
  /** Recursively removes the temp directory holding both files. */
  cleanup: () => Promise<void>
}

/** Post-split layout (`deepnote split`): init lives only in a sibling file. Two main blocks reference
 *  `init_value` so missing init resolution yields a false `undefined-variable` on the second block. */
export async function createSplitWithSiblingInitFixture(
  prefix = 'deepnote-split-init-'
): Promise<SplitWithSiblingInitFixture> {
  const tempDir = await fs.mkdtemp(join(os.tmpdir(), prefix))

  const projectId = 'proj-split-init'
  const initNotebookId = 'nb-init'

  const initFile: DeepnoteFile = {
    version: '1.0.0',
    metadata: { createdAt: '2025-01-01T00:00:00Z' },
    project: {
      id: projectId,
      name: 'Split Init Project',
      initNotebookId,
      notebooks: [
        {
          id: initNotebookId,
          name: 'Init',
          blocks: [
            {
              id: 'init-b1',
              type: 'code',
              blockGroup: 'bg-init-b1',
              sortingKey: '000',
              // `init_value` is consumed by the main notebook; `init_only_unused` is defined here and
              // used nowhere, so a composed-in init makes lint emit an `unused-variable` for it — an
              // issue that cannot exist unless the sibling init was resolved.
              content: 'import math\ninit_value = 42\ninit_only_unused = 7',
              metadata: {},
            },
          ],
        },
      ],
    },
  }

  const mainFile: DeepnoteFile = {
    version: '1.0.0',
    metadata: { createdAt: '2025-01-01T00:00:00Z' },
    project: {
      id: projectId,
      name: 'Split Init Project',
      initNotebookId,
      notebooks: [
        {
          id: 'nb-main',
          name: 'Main',
          blocks: [
            {
              id: 'main-b1',
              type: 'code',
              blockGroup: 'bg-main-b1',
              sortingKey: '000',
              content: 'first = init_value + 1',
              metadata: {},
            },
            {
              id: 'main-b2',
              type: 'code',
              blockGroup: 'bg-main-b2',
              sortingKey: '001',
              content: 'second = init_value + first',
              metadata: {},
            },
          ],
        },
      ],
    },
  }

  const initPath = join(tempDir, 'project-init.deepnote')
  const mainPath = join(tempDir, 'project-main.deepnote')
  await fs.writeFile(initPath, serializeDeepnoteFile(initFile), 'utf8')
  await fs.writeFile(mainPath, serializeDeepnoteFile(mainFile), 'utf8')

  return {
    mainPath,
    initPath,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true })
    },
  }
}
