import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { serializeDeepnoteFile } from '@deepnote/blocks'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveAndComposeInit, resolveAndComposeInitIfNeeded } from './resolve-init'

/** Constructs a `DeepnoteFile`, optionally declaring an init notebook. */
function makeFile(args: {
  projectId: string
  projectName?: string
  initNotebookId?: string
  notebooks: Array<{
    id: string
    name: string
    blocks?: Array<{ id: string; type?: string }>
  }>
  integrations?: Array<{ id: string; name: string; type: string }>
  settings?: Record<string, unknown>
}): DeepnoteFile {
  return {
    version: '1.0.0',
    metadata: { createdAt: '2025-01-01T00:00:00Z' },
    project: {
      id: args.projectId,
      name: args.projectName ?? 'Test Project',
      ...(args.initNotebookId !== undefined ? { initNotebookId: args.initNotebookId } : {}),
      ...(args.integrations !== undefined ? { integrations: args.integrations } : {}),
      ...(args.settings !== undefined ? { settings: args.settings } : {}),
      notebooks: args.notebooks.map(nb => ({
        id: nb.id,
        name: nb.name,
        blocks: (nb.blocks ?? []).map((b, i) => ({
          id: b.id,
          type: (b.type ?? 'code') as 'code',
          blockGroup: `bg-${b.id}`,
          sortingKey: `00${i}`,
          content: `# ${b.id}`,
          metadata: {},
        })),
      })),
    },
  }
}

describe('resolveAndComposeInit', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-init-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('passes through unchanged when the file does not declare an init notebook', async () => {
    const file = makeFile({
      projectId: 'proj-1',
      notebooks: [{ id: 'nb-main', name: 'Main', blocks: [{ id: 'b1' }] }],
    })
    const filePath = path.join(tempDir, 'main.deepnote')
    await fs.writeFile(filePath, serializeDeepnoteFile(file), 'utf-8')

    const result = await resolveAndComposeInit(file, filePath)

    expect(result.composed).toBe(file)
    expect(result.warnings).toEqual([])
  })

  it('passes through unchanged for self-contained file (initNotebookId resolves locally)', async () => {
    const file = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [
        { id: 'nb-init', name: 'Init', blocks: [{ id: 'init-b1' }] },
        { id: 'nb-main', name: 'Main', blocks: [{ id: 'main-b1' }] },
      ],
    })
    const filePath = path.join(tempDir, 'main.deepnote')
    await fs.writeFile(filePath, serializeDeepnoteFile(file), 'utf-8')

    const result = await resolveAndComposeInit(file, filePath)

    expect(result.composed).toBe(file)
    expect(result.warnings).toEqual([])
  })

  it('composes init blocks first when exactly one matching sibling exists', async () => {
    const initFile = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [
        {
          id: 'nb-init',
          name: 'Init',
          blocks: [{ id: 'init-b1' }, { id: 'init-b2' }],
        },
      ],
    })
    const mainFile = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-main', name: 'Main', blocks: [{ id: 'main-b1' }] }],
    })

    const initPath = path.join(tempDir, 'project-init.deepnote')
    const mainPath = path.join(tempDir, 'project-main.deepnote')
    await fs.writeFile(initPath, serializeDeepnoteFile(initFile), 'utf-8')
    await fs.writeFile(mainPath, serializeDeepnoteFile(mainFile), 'utf-8')

    const result = await resolveAndComposeInit(mainFile, mainPath)

    expect(result.composed.project.notebooks).toHaveLength(2)
    expect(result.composed.project.notebooks[0].id).toBe('nb-init')
    expect(result.composed.project.notebooks[1].id).toBe('nb-main')
    expect(result.warnings).toEqual([])
  })

  it('preserves the main file metadata when composing (id, name, settings)', async () => {
    const initFile = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-init', name: 'Init', blocks: [{ id: 'init-b1' }] }],
    })
    const mainFile = makeFile({
      projectId: 'proj-1',
      projectName: 'Main Project',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-main', name: 'Main', blocks: [{ id: 'main-b1' }] }],
    })
    const initPath = path.join(tempDir, 'project-init.deepnote')
    const mainPath = path.join(tempDir, 'project-main.deepnote')
    await fs.writeFile(initPath, serializeDeepnoteFile(initFile), 'utf-8')
    await fs.writeFile(mainPath, serializeDeepnoteFile(mainFile), 'utf-8')

    const result = await resolveAndComposeInit(mainFile, mainPath)

    expect(result.composed.project.id).toBe('proj-1')
    expect(result.composed.project.name).toBe('Main Project')
    expect(result.composed.project.initNotebookId).toBe('nb-init')
  })

  it('rejects the original unsplit source file with multiple notebooks (rule b)', async () => {
    const originalUnsplit = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [
        { id: 'nb-init', name: 'Init', blocks: [{ id: 'init-b1' }] },
        { id: 'nb-main', name: 'Main', blocks: [{ id: 'main-b1' }] },
        { id: 'nb-other', name: 'Other', blocks: [] },
      ],
    })
    const mainFile = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-main', name: 'Main', blocks: [{ id: 'main-b1' }] }],
    })

    const originalPath = path.join(tempDir, 'project.deepnote')
    const mainPath = path.join(tempDir, 'project-main.deepnote')
    await fs.writeFile(originalPath, serializeDeepnoteFile(originalUnsplit), 'utf-8')
    await fs.writeFile(mainPath, serializeDeepnoteFile(mainFile), 'utf-8')

    await expect(resolveAndComposeInit(mainFile, mainPath)).rejects.toThrow(/Cannot resolve init notebook/)
    await expect(resolveAndComposeInit(mainFile, mainPath)).rejects.toThrow(/nb-init/)
  })

  it('still composes when an init sibling and the original unsplit file coexist', async () => {
    // Multi-notebook original is rejected; the init-only sibling still matches.
    const initSibling = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-init', name: 'Init', blocks: [{ id: 'init-b1' }] }],
    })
    const originalUnsplit = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [
        { id: 'nb-init', name: 'Init', blocks: [{ id: 'init-b1' }] },
        { id: 'nb-main', name: 'Main', blocks: [{ id: 'main-b1' }] },
      ],
    })
    const mainFile = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-main', name: 'Main', blocks: [{ id: 'main-b1' }] }],
    })

    const originalPath = path.join(tempDir, 'project.deepnote')
    const initPath = path.join(tempDir, 'project-init.deepnote')
    const mainPath = path.join(tempDir, 'project-main.deepnote')
    await fs.writeFile(originalPath, serializeDeepnoteFile(originalUnsplit), 'utf-8')
    await fs.writeFile(initPath, serializeDeepnoteFile(initSibling), 'utf-8')
    await fs.writeFile(mainPath, serializeDeepnoteFile(mainFile), 'utf-8')

    const result = await resolveAndComposeInit(mainFile, mainPath)
    expect(result.composed.project.notebooks.map(n => n.id)).toEqual(['nb-init', 'nb-main'])
  })

  it('throws a clear error naming the missing init id and the searched directory when no sibling provides it', async () => {
    const mainFile = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-missing-init',
      notebooks: [{ id: 'nb-main', name: 'Main', blocks: [{ id: 'main-b1' }] }],
    })
    const mainPath = path.join(tempDir, 'project-main.deepnote')
    await fs.writeFile(mainPath, serializeDeepnoteFile(mainFile), 'utf-8')

    let captured: Error | undefined
    try {
      await resolveAndComposeInit(mainFile, mainPath)
    } catch (err) {
      captured = err as Error
    }
    expect(captured).toBeDefined()
    const message = captured?.message ?? ''
    expect(message).toContain('nb-missing-init')
    expect(message).toContain(tempDir)
    expect(message).toContain('Cannot resolve init notebook')
  })

  it('throws with both candidate paths listed when multiple matching siblings exist', async () => {
    const initFileA = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-init', name: 'Init', blocks: [{ id: 'init-b1' }] }],
    })
    const initFileB = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-init', name: 'Init', blocks: [{ id: 'init-b1' }] }],
    })
    const mainFile = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-main', name: 'Main', blocks: [{ id: 'main-b1' }] }],
    })

    const initPathA = path.join(tempDir, 'a-init.deepnote')
    const initPathB = path.join(tempDir, 'b-init.deepnote')
    const mainPath = path.join(tempDir, 'main.deepnote')
    await fs.writeFile(initPathA, serializeDeepnoteFile(initFileA), 'utf-8')
    await fs.writeFile(initPathB, serializeDeepnoteFile(initFileB), 'utf-8')
    await fs.writeFile(mainPath, serializeDeepnoteFile(mainFile), 'utf-8')

    let captured: Error | undefined
    try {
      await resolveAndComposeInit(mainFile, mainPath)
    } catch (err) {
      captured = err as Error
    }
    expect(captured).toBeDefined()
    const message = captured?.message ?? ''
    expect(message).toContain('multiple matching sibling init files')
    expect(message).toContain(initPathA)
    expect(message).toContain(initPathB)
  })

  it('skips corrupt sibling YAML without aborting the resolution', async () => {
    const initSibling = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-init', name: 'Init', blocks: [{ id: 'init-b1' }] }],
    })
    const mainFile = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-main', name: 'Main', blocks: [{ id: 'main-b1' }] }],
    })

    const corruptPath = path.join(tempDir, 'corrupt.deepnote')
    const initPath = path.join(tempDir, 'init.deepnote')
    const mainPath = path.join(tempDir, 'main.deepnote')
    await fs.writeFile(corruptPath, '{not: valid: yaml: [unbalanced', 'utf-8')
    await fs.writeFile(initPath, serializeDeepnoteFile(initSibling), 'utf-8')
    await fs.writeFile(mainPath, serializeDeepnoteFile(mainFile), 'utf-8')

    const result = await resolveAndComposeInit(mainFile, mainPath)
    expect(result.composed.project.notebooks.map(n => n.id)).toEqual(['nb-init', 'nb-main'])
  })

  it('does not abort when the only candidate is corrupt — it throws the missing-init error instead', async () => {
    const mainFile = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-main', name: 'Main', blocks: [{ id: 'main-b1' }] }],
    })

    const corruptPath = path.join(tempDir, 'init.deepnote')
    const mainPath = path.join(tempDir, 'main.deepnote')
    await fs.writeFile(corruptPath, 'this is not valid:: yaml :::', 'utf-8')
    await fs.writeFile(mainPath, serializeDeepnoteFile(mainFile), 'utf-8')

    let captured: Error | undefined
    try {
      await resolveAndComposeInit(mainFile, mainPath)
    } catch (err) {
      captured = err as Error
    }
    expect(captured).toBeDefined()
    expect(captured?.message).toContain('Cannot resolve init notebook')
    expect(captured?.message).toContain(corruptPath)
  })

  it('composes a stale init sibling whose ids match (staleness detection deferred by design)', async () => {
    // Init id matches but block content diverged; staleness detection is deferred by design, so this still composes.
    const staleInit = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [
        {
          id: 'nb-init',
          name: 'Init',
          blocks: [{ id: 'init-b1', type: 'code' }],
        },
      ],
    })
    staleInit.project.notebooks[0].blocks[0].content = '# stale init body'

    const mainFile = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-main', name: 'Main', blocks: [{ id: 'main-b1' }] }],
    })

    const initPath = path.join(tempDir, 'init.deepnote')
    const mainPath = path.join(tempDir, 'main.deepnote')
    await fs.writeFile(initPath, serializeDeepnoteFile(staleInit), 'utf-8')
    await fs.writeFile(mainPath, serializeDeepnoteFile(mainFile), 'utf-8')

    const result = await resolveAndComposeInit(mainFile, mainPath)
    expect(result.composed.project.notebooks.map(n => n.id)).toEqual(['nb-init', 'nb-main'])
    expect(result.warnings).toEqual([])
  })

  it('emits a warning when integrations diverge between sibling and main but still composes', async () => {
    const initSibling = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-init', name: 'Init', blocks: [{ id: 'init-b1' }] }],
      integrations: [{ id: 'int-1', name: 'Old DB', type: 'pgsql' }],
    })
    const mainFile = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-main', name: 'Main', blocks: [{ id: 'main-b1' }] }],
      integrations: [{ id: 'int-1', name: 'New DB', type: 'pgsql' }],
    })

    const initPath = path.join(tempDir, 'init.deepnote')
    const mainPath = path.join(tempDir, 'main.deepnote')
    await fs.writeFile(initPath, serializeDeepnoteFile(initSibling), 'utf-8')
    await fs.writeFile(mainPath, serializeDeepnoteFile(mainFile), 'utf-8')

    const result = await resolveAndComposeInit(mainFile, mainPath)
    expect(result.composed.project.notebooks.map(n => n.id)).toEqual(['nb-init', 'nb-main'])
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.some(w => /integrations/i.test(w))).toBe(true)
  })

  it('emits a warning when settings diverge between sibling and main but still composes', async () => {
    const initSibling = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-init', name: 'Init', blocks: [{ id: 'init-b1' }] }],
      settings: { requirements: ['pandas==1.0.0'] },
    })
    const mainFile = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-main', name: 'Main', blocks: [{ id: 'main-b1' }] }],
      settings: { requirements: ['pandas==2.1.0'] },
    })

    const initPath = path.join(tempDir, 'init.deepnote')
    const mainPath = path.join(tempDir, 'main.deepnote')
    await fs.writeFile(initPath, serializeDeepnoteFile(initSibling), 'utf-8')
    await fs.writeFile(mainPath, serializeDeepnoteFile(mainFile), 'utf-8')

    const result = await resolveAndComposeInit(mainFile, mainPath)
    expect(result.composed.project.notebooks.map(n => n.id)).toEqual(['nb-init', 'nb-main'])
    expect(result.warnings.some(w => /settings/i.test(w))).toBe(true)
  })

  it('rejects siblings with a different project.id', async () => {
    const wrongProjectInit = makeFile({
      projectId: 'proj-OTHER',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-init', name: 'Init', blocks: [{ id: 'init-b1' }] }],
    })
    const mainFile = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-main', name: 'Main', blocks: [{ id: 'main-b1' }] }],
    })

    const wrongInitPath = path.join(tempDir, 'wrong-init.deepnote')
    const mainPath = path.join(tempDir, 'main.deepnote')
    await fs.writeFile(wrongInitPath, serializeDeepnoteFile(wrongProjectInit), 'utf-8')
    await fs.writeFile(mainPath, serializeDeepnoteFile(mainFile), 'utf-8')

    await expect(resolveAndComposeInit(mainFile, mainPath)).rejects.toThrow(/Cannot resolve init notebook/)
  })

  it('ignores non-.deepnote files in the directory', async () => {
    const initSibling = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-init', name: 'Init', blocks: [{ id: 'init-b1' }] }],
    })
    const mainFile = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-main', name: 'Main', blocks: [{ id: 'main-b1' }] }],
    })
    const initPath = path.join(tempDir, 'init.deepnote')
    const mainPath = path.join(tempDir, 'main.deepnote')
    const noisePath = path.join(tempDir, 'README.md')
    await fs.writeFile(initPath, serializeDeepnoteFile(initSibling), 'utf-8')
    await fs.writeFile(mainPath, serializeDeepnoteFile(mainFile), 'utf-8')
    await fs.writeFile(noisePath, 'unrelated content', 'utf-8')

    const result = await resolveAndComposeInit(mainFile, mainPath)
    expect(result.composed.project.notebooks.map(n => n.id)).toEqual(['nb-init', 'nb-main'])
  })
})

describe('resolveAndComposeInitIfNeeded', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-init-if-needed-test-'))
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('passes through a non-deepnote file unchanged without touching the filesystem', async () => {
    const file = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-main', name: 'Main', blocks: [{ id: 'main-b1' }] }],
    })
    // Path in a non-existent directory: a passthrough must not attempt any readdir.
    const originalPath = path.join(tempDir, 'does-not-exist', 'main.ipynb')

    const loaded = { file, originalPath, format: 'jupyter' }
    const result = await resolveAndComposeInitIfNeeded(loaded)

    expect(result.composed).toBe(loaded.file)
    expect(result.warnings).toEqual([])
  })

  it('passes through a deepnote file with no initNotebookId without touching the filesystem', async () => {
    const file = makeFile({
      projectId: 'proj-1',
      notebooks: [{ id: 'nb-main', name: 'Main', blocks: [{ id: 'main-b1' }] }],
    })
    const originalPath = path.join(tempDir, 'does-not-exist', 'main.deepnote')

    const result = await resolveAndComposeInitIfNeeded({ file, originalPath, format: 'deepnote' })

    expect(result.composed).toBe(file)
    expect(result.warnings).toEqual([])
  })

  it('passes through a self-contained deepnote file whose init resolves locally', async () => {
    const file = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [
        { id: 'nb-init', name: 'Init', blocks: [{ id: 'init-b1' }] },
        { id: 'nb-main', name: 'Main', blocks: [{ id: 'main-b1' }] },
      ],
    })
    const originalPath = path.join(tempDir, 'main.deepnote')
    await fs.writeFile(originalPath, serializeDeepnoteFile(file), 'utf-8')

    const result = await resolveAndComposeInitIfNeeded({ file, originalPath, format: 'deepnote' })

    expect(result.composed).toBe(file)
    expect(result.warnings).toEqual([])
  })

  it('composes a sibling init notebook for a deepnote file that declares one', async () => {
    const initFile = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [
        {
          id: 'nb-init',
          name: 'Init',
          blocks: [{ id: 'init-b1' }, { id: 'init-b2' }],
        },
      ],
    })
    const mainFile = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-main', name: 'Main', blocks: [{ id: 'main-b1' }] }],
    })

    const initPath = path.join(tempDir, 'project-init.deepnote')
    const mainPath = path.join(tempDir, 'project-main.deepnote')
    await fs.writeFile(initPath, serializeDeepnoteFile(initFile), 'utf-8')
    await fs.writeFile(mainPath, serializeDeepnoteFile(mainFile), 'utf-8')

    const result = await resolveAndComposeInitIfNeeded({
      file: mainFile,
      originalPath: mainPath,
      format: 'deepnote',
    })

    expect(result.composed.project.notebooks).toHaveLength(2)
    expect(result.composed.project.notebooks[0].id).toBe('nb-init')
    expect(result.composed.project.notebooks[1].id).toBe('nb-main')
    expect(result.warnings).toEqual([])
  })

  it('propagates warnings from the underlying resolution when a sibling diverges', async () => {
    const initSibling = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-init', name: 'Init', blocks: [{ id: 'init-b1' }] }],
      integrations: [{ id: 'int-1', name: 'Old DB', type: 'pgsql' }],
    })
    const mainFile = makeFile({
      projectId: 'proj-1',
      initNotebookId: 'nb-init',
      notebooks: [{ id: 'nb-main', name: 'Main', blocks: [{ id: 'main-b1' }] }],
      integrations: [{ id: 'int-1', name: 'New DB', type: 'pgsql' }],
    })

    const initPath = path.join(tempDir, 'init.deepnote')
    const mainPath = path.join(tempDir, 'main.deepnote')
    await fs.writeFile(initPath, serializeDeepnoteFile(initSibling), 'utf-8')
    await fs.writeFile(mainPath, serializeDeepnoteFile(mainFile), 'utf-8')

    const result = await resolveAndComposeInitIfNeeded({
      file: mainFile,
      originalPath: mainPath,
      format: 'deepnote',
    })

    expect(result.composed.project.notebooks.map(n => n.id)).toEqual(['nb-init', 'nb-main'])
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})
