import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { DeepnoteFile, DeepnoteSnapshot } from '@deepnote/blocks'
import { deserializeDeepnoteFile, serializeDeepnoteFile, serializeDeepnoteSnapshot } from '@deepnote/blocks'
import { loadSnapshotFile } from '@deepnote/convert'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { resetOutputConfig, setOutputConfig } from '../output'
import { createSplitAction } from './split'

function createMultiNotebookFile(notebookNames: string[]): DeepnoteFile {
  return {
    version: '1.0.0',
    metadata: { createdAt: '2025-01-01T00:00:00Z' },
    project: {
      id: '2e814690-4f02-465c-8848-5567ab9253b7',
      name: 'Test Project',
      settings: { requirements: ['pandas'] },
      notebooks: notebookNames.map((name, i) => ({
        id: `nb-${i + 1}`,
        name,
        blocks: [
          {
            id: `block-${i + 1}`,
            type: 'code' as const,
            blockGroup: `bg-${i + 1}`,
            sortingKey: `000${i}`,
            content: `print("${name}")`,
            metadata: {},
          },
        ],
      })),
    },
  }
}

describe('split command', () => {
  let tempDir: string
  let program: Command
  let consoleSpy: Mock<typeof console.log>
  let consoleErrorSpy: Mock<typeof console.error>

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'split-test-'))
    program = new Command()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    resetOutputConfig()
    setOutputConfig({ quiet: true })
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    resetOutputConfig()
  })

  it('should split 2-notebook file into 2 files', async () => {
    const file = createMultiNotebookFile(['Dashboard', 'Data'])
    const inputPath = path.join(tempDir, 'project.deepnote')
    await fs.writeFile(inputPath, serializeDeepnoteFile(file), 'utf-8')

    const action = createSplitAction(program)
    await action(inputPath, {})

    const files = await fs.readdir(tempDir)
    const deepnoteFiles = files.filter(f => f.endsWith('.deepnote') && f !== 'project.deepnote').sort()
    expect(deepnoteFiles).toEqual(['project-dashboard.deepnote', 'project-data.deepnote'])
  })

  it('should preserve project metadata in each split file', async () => {
    const file = createMultiNotebookFile(['Dashboard', 'Data'])
    const inputPath = path.join(tempDir, 'project.deepnote')
    await fs.writeFile(inputPath, serializeDeepnoteFile(file), 'utf-8')

    const action = createSplitAction(program)
    await action(inputPath, {})

    for (const name of ['project-dashboard.deepnote', 'project-data.deepnote']) {
      const content = await fs.readFile(path.join(tempDir, name), 'utf-8')
      const parsed = deserializeDeepnoteFile(content)
      expect(parsed.project.id).toBe('2e814690-4f02-465c-8848-5567ab9253b7')
      expect(parsed.project.name).toBe('Test Project')
      expect(parsed.project.notebooks).toHaveLength(1)
    }
  })

  it('should not create files for single-notebook file', async () => {
    const file = createMultiNotebookFile(['Single'])
    const inputPath = path.join(tempDir, 'project.deepnote')
    await fs.writeFile(inputPath, serializeDeepnoteFile(file), 'utf-8')

    const action = createSplitAction(program)
    await action(inputPath, {})

    const files = await fs.readdir(tempDir)
    const deepnoteFiles = files.filter(f => f.endsWith('.deepnote') && f !== 'project.deepnote')
    expect(deepnoteFiles).toHaveLength(0)
  })

  it('should write to output directory when specified', async () => {
    const file = createMultiNotebookFile(['Dashboard', 'Data'])
    const inputPath = path.join(tempDir, 'project.deepnote')
    const outputDir = path.join(tempDir, 'output')
    await fs.writeFile(inputPath, serializeDeepnoteFile(file), 'utf-8')

    const action = createSplitAction(program)
    await action(inputPath, { output: outputDir })

    const files = await fs.readdir(outputDir)
    expect(files.filter(f => f.endsWith('.deepnote'))).toHaveLength(2)
  })

  it('should split 3-notebook file into 3 files', async () => {
    const file = createMultiNotebookFile(['Dashboard', 'Data', 'Utils'])
    const inputPath = path.join(tempDir, 'project.deepnote')
    await fs.writeFile(inputPath, serializeDeepnoteFile(file), 'utf-8')

    const action = createSplitAction(program)
    await action(inputPath, {})

    const files = await fs.readdir(tempDir)
    const deepnoteFiles = files.filter(f => f.endsWith('.deepnote') && f !== 'project.deepnote')
    expect(deepnoteFiles).toHaveLength(3)
  })

  it('should produce one split file per notebook including a standalone init file', async () => {
    const file: DeepnoteFile = {
      version: '1.0.0',
      metadata: { createdAt: '2025-01-01T00:00:00Z' },
      project: {
        id: '2e814690-4f02-465c-8848-5567ab9253b7',
        name: 'Test Project',
        initNotebookId: 'nb-init',
        notebooks: [
          { id: 'nb-init', name: 'Init', blocks: [] },
          { id: 'nb-a', name: 'Alpha', blocks: [] },
          { id: 'nb-b', name: 'Beta', blocks: [] },
        ],
      },
    }
    const inputPath = path.join(tempDir, 'project.deepnote')
    await fs.writeFile(inputPath, serializeDeepnoteFile(file), 'utf-8')

    const action = createSplitAction(program)
    await action(inputPath, {})

    const files = await fs.readdir(tempDir)
    const deepnoteFiles = files.filter(f => f.endsWith('.deepnote') && f !== 'project.deepnote').sort()
    // 1 init file + 2 main files
    expect(deepnoteFiles).toHaveLength(3)

    let initFiles = 0
    let mainFiles = 0
    for (const name of deepnoteFiles) {
      const parsed = deserializeDeepnoteFile(await fs.readFile(path.join(tempDir, name), 'utf-8'))
      expect(parsed.project.notebooks).toHaveLength(1)
      const onlyId = parsed.project.notebooks[0]?.id
      // initNotebookId is preserved on every split so the run-time resolver can find the sibling init.
      expect(parsed.project.initNotebookId).toBe('nb-init')
      if (onlyId === 'nb-init') {
        initFiles += 1
      } else {
        mainFiles += 1
      }
    }
    expect(initFiles).toBe(1)
    expect(mainFiles).toBe(2)
  })

  it('should fail if output files exist without --force', async () => {
    const file = createMultiNotebookFile(['Dashboard', 'Data'])
    const inputPath = path.join(tempDir, 'project.deepnote')
    await fs.writeFile(inputPath, serializeDeepnoteFile(file), 'utf-8')
    await fs.writeFile(path.join(tempDir, 'project-dashboard.deepnote'), 'existing', 'utf-8')

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    try {
      const action = createSplitAction(program)
      await action(inputPath, {})
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
    }
  })

  it('should overwrite existing files with --force', async () => {
    const file = createMultiNotebookFile(['Dashboard', 'Data'])
    const inputPath = path.join(tempDir, 'project.deepnote')
    await fs.writeFile(inputPath, serializeDeepnoteFile(file), 'utf-8')
    await fs.writeFile(path.join(tempDir, 'project-dashboard.deepnote'), 'existing', 'utf-8')

    const action = createSplitAction(program)
    await action(inputPath, { force: true })

    const content = await fs.readFile(path.join(tempDir, 'project-dashboard.deepnote'), 'utf-8')
    expect(content).not.toBe('existing')
    const parsed = deserializeDeepnoteFile(content)
    expect(parsed.project.notebooks).toHaveLength(1)
  })

  it('should disambiguate split filenames when two notebook names collide on slugified filename', async () => {
    // Arrange
    const file = createMultiNotebookFile(['Dashboard', 'DASHBOARD'])
    const inputPath = path.join(tempDir, 'project.deepnote')
    await fs.writeFile(inputPath, serializeDeepnoteFile(file), 'utf-8')

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    try {
      // Act
      const action = createSplitAction(program)
      await action(inputPath, {})

      // Assert
      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
    }

    const files = (await fs.readdir(tempDir)).filter(f => f.endsWith('.deepnote') && f !== 'project.deepnote').sort()
    expect(files).toEqual(['project-dashboard-2.deepnote', 'project-dashboard.deepnote'])
  })

  it('should disambiguate split filenames when notebook names differ only by punctuation', async () => {
    // Arrange
    const file = createMultiNotebookFile(['Dashboard!', 'Dashboard?'])
    const inputPath = path.join(tempDir, 'project.deepnote')
    await fs.writeFile(inputPath, serializeDeepnoteFile(file), 'utf-8')

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    try {
      // Act
      const action = createSplitAction(program)
      await action(inputPath, {})

      // Assert
      expect(exitSpy).not.toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
    }

    const files = (await fs.readdir(tempDir)).filter(f => f.endsWith('.deepnote') && f !== 'project.deepnote').sort()
    expect(files).toEqual(['project-dashboard-2.deepnote', 'project-dashboard.deepnote'])
  })

  it('should leave no observable .tmp files in the output directory after a successful split', async () => {
    const file = createMultiNotebookFile(['Dashboard', 'Data'])
    const inputPath = path.join(tempDir, 'project.deepnote')
    await fs.writeFile(inputPath, serializeDeepnoteFile(file), 'utf-8')

    const action = createSplitAction(program)
    await action(inputPath, {})

    const files = await fs.readdir(tempDir)
    const tempFiles = files.filter(f => f.endsWith('.tmp'))
    expect(tempFiles).toEqual([])
  })

  it('should write each split file as one-notebook entry (no duplicated init)', async () => {
    const initId = 'nb-init-id'
    const file: DeepnoteFile = {
      version: '1.0.0',
      metadata: { createdAt: '2025-01-01T00:00:00Z' },
      project: {
        id: '2e814690-4f02-465c-8848-5567ab9253b7',
        name: 'Test Project',
        initNotebookId: initId,
        notebooks: [
          {
            id: initId,
            name: 'Init',
            blocks: [
              {
                id: 'init-block',
                type: 'code' as const,
                blockGroup: 'bg-init',
                sortingKey: '0000',
                content: 'INIT_VAR = 1',
                metadata: {},
              },
            ],
          },
          {
            id: 'nb-main',
            name: 'Main',
            blocks: [
              {
                id: 'main-block',
                type: 'code' as const,
                blockGroup: 'bg-main',
                sortingKey: '0000',
                content: 'print(INIT_VAR)',
                metadata: {},
              },
            ],
          },
        ],
      },
    }
    const inputPath = path.join(tempDir, 'project.deepnote')
    await fs.writeFile(inputPath, serializeDeepnoteFile(file), 'utf-8')

    const action = createSplitAction(program)
    await action(inputPath, {})

    const files = (await fs.readdir(tempDir)).filter(f => f.endsWith('.deepnote') && f !== 'project.deepnote').sort()
    expect(files).toHaveLength(2)

    let initSeen = false
    let mainSeen = false
    for (const name of files) {
      const parsed = deserializeDeepnoteFile(await fs.readFile(path.join(tempDir, name), 'utf-8'))
      // The new model emits exactly one notebook per split file (no duplicated
      // init) and preserves initNotebookId so the run-time resolver can find
      // the sibling init.
      expect(parsed.project.notebooks).toHaveLength(1)
      expect(parsed.project.initNotebookId).toBe(initId)
      const onlyId = parsed.project.notebooks[0].id
      if (onlyId === initId) {
        initSeen = true
      } else if (onlyId === 'nb-main') {
        mainSeen = true
      }
    }
    expect(initSeen).toBe(true)
    expect(mainSeen).toBe(true)
  })

  it('should emit a [init] snapshot for the standalone init file and [init,main] snapshot for each main file', async () => {
    const projectId = '2e814690-4f02-465c-8848-5567ab9253b7'
    const initId = 'nb-init-id'
    const file: DeepnoteFile = {
      version: '1.0.0',
      metadata: { createdAt: '2025-01-01T00:00:00Z' },
      project: {
        id: projectId,
        name: 'Test Project',
        initNotebookId: initId,
        notebooks: [
          {
            id: initId,
            name: 'Init',
            blocks: [
              {
                id: 'init-block',
                type: 'code' as const,
                blockGroup: 'bg-init',
                sortingKey: '0000',
                content: 'INIT_VAR = 1',
                metadata: {},
              },
            ],
          },
          {
            id: 'nb-main',
            name: 'Main',
            blocks: [
              {
                id: 'main-block',
                type: 'code' as const,
                blockGroup: 'bg-main',
                sortingKey: '0000',
                content: 'print(INIT_VAR)',
                metadata: {},
              },
            ],
          },
        ],
      },
    }
    const inputPath = path.join(tempDir, 'project.deepnote')
    await fs.writeFile(inputPath, serializeDeepnoteFile(file), 'utf-8')

    // Pre-existing snapshot for the whole project, with outputs from a prior run.
    const snapshot: DeepnoteSnapshot = {
      version: '1.0.0',
      metadata: { createdAt: '2025-01-01T00:00:00Z', snapshotHash: 'sha256:abc' },
      environment: { hash: 'env-1' },
      execution: { startedAt: '2025-01-01T00:00:00Z', finishedAt: '2025-01-01T00:01:00Z' },
      project: {
        id: projectId,
        name: 'Test Project',
        initNotebookId: initId,
        notebooks: [
          {
            id: initId,
            name: 'Init',
            blocks: [
              {
                id: 'init-block',
                type: 'code' as const,
                blockGroup: 'bg-init',
                sortingKey: '0000',
                content: 'INIT_VAR = 1',
                outputs: [{ output_type: 'stream', name: 'stdout', text: ['init-output'] }],
                executionCount: 1,
                metadata: {},
              },
            ],
          },
          {
            id: 'nb-main',
            name: 'Main',
            blocks: [
              {
                id: 'main-block',
                type: 'code' as const,
                blockGroup: 'bg-main',
                sortingKey: '0000',
                content: 'print(INIT_VAR)',
                outputs: [{ output_type: 'stream', name: 'stdout', text: ['1\n'] }],
                executionCount: 2,
                metadata: {},
              },
            ],
          },
        ],
      },
    }
    const snapshotsDir = path.join(tempDir, 'snapshots')
    await fs.mkdir(snapshotsDir, { recursive: true })
    const originalSnapshotName = `test-project_${projectId}_latest.snapshot.deepnote`
    await fs.writeFile(path.join(snapshotsDir, originalSnapshotName), serializeDeepnoteSnapshot(snapshot), 'utf-8')

    const action = createSplitAction(program)
    await action(inputPath, {})

    const snapshotFiles = (await fs.readdir(snapshotsDir)).filter(f => f.endsWith('.snapshot.deepnote'))
    // Should now have at least the init snapshot and the main snapshot.
    const initSnapshotName = snapshotFiles.find(f => f.includes(initId))
    const mainSnapshotName = snapshotFiles.find(f => f.includes('nb-main'))
    expect(initSnapshotName, `init snapshot present in ${JSON.stringify(snapshotFiles)}`).toBeTruthy()
    expect(mainSnapshotName, `main snapshot present in ${JSON.stringify(snapshotFiles)}`).toBeTruthy()

    // Init snapshot: [init] shape
    if (initSnapshotName) {
      const parsed = await loadSnapshotFile(path.join(snapshotsDir, initSnapshotName))
      expect(parsed.project.notebooks).toHaveLength(1)
      expect(parsed.project.notebooks[0].id).toBe(initId)
    }

    // Main snapshot: [init, main] shape so each main snapshot remains a complete
    // record of what would run.
    if (mainSnapshotName) {
      const parsed = await loadSnapshotFile(path.join(snapshotsDir, mainSnapshotName))
      expect(parsed.project.notebooks).toHaveLength(2)
      const ids = parsed.project.notebooks.map(n => n.id).sort()
      expect(ids).toEqual([initId, 'nb-main'].sort())
    }

    // No leftover .tmp files in snapshots dir either.
    const tempFiles = (await fs.readdir(snapshotsDir)).filter(f => f.endsWith('.tmp'))
    expect(tempFiles).toEqual([])
  })

  it('should print a warning when a snapshot fails to split but still write the notebook files', async () => {
    // Arrange
    const projectId = '2e814690-4f02-465c-8848-5567ab9253b7'
    const file = createMultiNotebookFile(['Dashboard', 'Data'])
    const inputPath = path.join(tempDir, 'project.deepnote')
    await fs.writeFile(inputPath, serializeDeepnoteFile(file), 'utf-8')

    const snapshotsDir = path.join(tempDir, 'snapshots')
    await fs.mkdir(snapshotsDir, { recursive: true })
    const corruptSnapshotName = `my-project_${projectId}_latest.snapshot.deepnote`
    await fs.writeFile(path.join(snapshotsDir, corruptSnapshotName), 'not: valid: yaml: [', 'utf-8')

    // Act
    const action = createSplitAction(program)
    await action(inputPath, {})

    // Assert
    const splitNames = ['project-dashboard.deepnote', 'project-data.deepnote']
    for (const name of splitNames) {
      await expect(fs.access(path.join(tempDir, name))).resolves.toBeUndefined()
    }

    const logged = consoleSpy.mock.calls.map(args => args.join(' ')).join('\n')
    expect(logged.includes('Warning') || logged.includes('could not be split')).toBe(true)
  })
})
