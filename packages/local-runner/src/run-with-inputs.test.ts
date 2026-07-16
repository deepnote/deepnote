import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { serializeDeepnoteSnapshot } from '@deepnote/blocks'
import type { AgentStreamEvent, BlockExecutionResult, ExecutionOptions, ExecutionSummary } from '@deepnote/runtime-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the execution engine so tests need no Python / deepnote-toolkit. `vi.hoisted` makes the
// mock fns available inside the hoisted `vi.mock` factory; a real class keeps `new` working.
const engineMock = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  runProject: vi.fn(),
}))

vi.mock('@deepnote/runtime-core', () => ({
  detectDefaultPython: () => '/usr/bin/python3',
  ExecutionEngine: class {
    start = engineMock.start
    stop = engineMock.stop
    runProject = engineMock.runProject
  },
}))

import { runWithInputs } from './run-with-inputs'

const NOTEBOOK = `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: p1
  name: Test
  notebooks:
    - id: nb1
      name: NB
      blocks:
        - blockGroup: g1
          content: ''
          id: i-count
          metadata:
            deepnote_variable_name: count
            deepnote_variable_value: '3'
            deepnote_slider_min_value: 1
            deepnote_slider_max_value: 100
            deepnote_slider_step: 1
          sortingKey: a0
          type: input-slider
        - blockGroup: g2
          content: print(count)
          id: c1
          metadata: {}
          sortingKey: a1
          type: code
version: '1.0.0'
`

// `flag` is a slider in "First" and a checkbox in "Second" — same name, different types — and each
// notebook has its own code block to target by id.
const MULTI = `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
project:
  id: p1
  name: Test
  notebooks:
    - id: nb1
      name: First
      blocks:
        - blockGroup: g0
          content: ''
          id: i-flag-1
          metadata:
            deepnote_variable_name: flag
            deepnote_variable_value: '1'
            deepnote_slider_min_value: 0
            deepnote_slider_max_value: 10
            deepnote_slider_step: 1
          sortingKey: a0
          type: input-slider
        - blockGroup: g1
          content: print(flag)
          id: code-1
          metadata: {}
          sortingKey: a1
          type: code
    - id: nb2
      name: Second
      blocks:
        - blockGroup: g0
          content: ''
          id: i-flag-2
          metadata:
            deepnote_variable_name: flag
            deepnote_variable_value: false
          sortingKey: a0
          type: input-checkbox
        - blockGroup: g1
          content: print(flag)
          id: code-2
          metadata: {}
          sortingKey: a1
          type: code
version: '1.0.0'
`

const SUMMARY: ExecutionSummary = { totalBlocks: 2, executedBlocks: 2, failedBlocks: 0, totalDurationMs: 5 }

function blockResult(overrides: Partial<BlockExecutionResult> = {}): BlockExecutionResult {
  return {
    blockId: 'c1',
    blockType: 'code',
    success: true,
    outputs: [{ output_type: 'stream', name: 'stdout', text: '7\n' }],
    executionCount: 1,
    durationMs: 5,
    ...overrides,
  }
}

let capturedFile: DeepnoteFile | undefined
let capturedOptions: ExecutionOptions | undefined

beforeEach(() => {
  vi.clearAllMocks()
  capturedFile = undefined
  capturedOptions = undefined
  engineMock.runProject.mockImplementation(async (file: DeepnoteFile, options: ExecutionOptions) => {
    capturedFile = file
    capturedOptions = options
    await options.onBlockDone?.(blockResult())
    return SUMMARY
  })
})

describe('runWithInputs', () => {
  it('coerces inputs for both the file and the kernel, and returns ordered outputs + a valid snapshot', async () => {
    const result = await runWithInputs(NOTEBOOK, { count: 7 })

    // Metadata on the executed file is coerced to the schema shape (string), ...
    const sliderMeta = capturedFile?.project.notebooks[0].blocks[0].metadata as Record<string, unknown>
    expect(sliderMeta.deepnote_variable_value).toBe('7')
    // ... and so is the kernel-injection payload: the engine validates overrides against the
    // block's schema shape, so a raw `7` for a slider would be rejected.
    expect(capturedOptions?.inputs).toEqual({ count: '7' })

    expect(result.outputs).toEqual([
      { blockId: 'c1', outputs: [{ output_type: 'stream', name: 'stdout', text: '7\n' }], executionCount: 1 },
    ])
    expect(result.summary.failedBlocks).toBe(0)
    expect(() => serializeDeepnoteSnapshot(result.snapshot)).not.toThrow()
    expect(result.snapshotYaml).toContain('stdout')
    expect(result.snapshotPath).toBeUndefined() // a YAML-string input has no path to persist beside

    expect(engineMock.start).toHaveBeenCalledOnce()
    expect(engineMock.stop).toHaveBeenCalledOnce()
  })

  it('scopes a block-targeted run (no --notebook) to the targeted block’s notebook', async () => {
    // `flag` is a slider in First and a checkbox in Second. Targeting Second's code block must type
    // `flag` as a checkbox (true) and inject only into Second — not reject `true` against the slider.
    await runWithInputs(MULTI, { flag: true }, { blockIds: ['code-2'] })

    expect(capturedOptions?.notebookName).toBe('Second')
    expect(capturedOptions?.inputs).toEqual({ flag: true })
    const nb1Flag = capturedFile?.project.notebooks[0].blocks[0].metadata as Record<string, unknown>
    const nb2Flag = capturedFile?.project.notebooks[1].blocks[0].metadata as Record<string, unknown>
    expect(nb2Flag.deepnote_variable_value).toBe(true) // Second's checkbox got the value
    expect(nb1Flag.deepnote_variable_value).toBe('1') // First's slider is untouched
  })

  it('forwards agent-block streaming events to onAgentEvent as the engine emits them', async () => {
    engineMock.runProject.mockImplementation(async (_file: DeepnoteFile, options: ExecutionOptions) => {
      await options.onAgentEvent?.({ type: 'reasoning_delta', text: 'thinking' })
      await options.onAgentEvent?.({ type: 'text_delta', text: 'hel' })
      await options.onAgentEvent?.({ type: 'text_delta', text: 'lo' })
      await options.onBlockDone?.(blockResult())
      return SUMMARY
    })

    const events: AgentStreamEvent[] = []
    await runWithInputs(NOTEBOOK, {}, { onAgentEvent: event => void events.push(event) })

    expect(events).toEqual([
      { type: 'reasoning_delta', text: 'thinking' },
      { type: 'text_delta', text: 'hel' },
      { type: 'text_delta', text: 'lo' },
    ])
  })

  it('passes names with no input block through to the kernel untouched', async () => {
    await runWithInputs(NOTEBOOK, { count: 7, not_a_block: { nested: 1 } })

    // Unmatched names have no schema shape to coerce to, so they reach the engine as-is for
    // generic Python-literal injection.
    expect(capturedOptions?.inputs).toEqual({ count: '7', not_a_block: { nested: 1 } })
  })

  it('returns a failed summary without throwing when a block fails', async () => {
    engineMock.runProject.mockImplementation(async (_file: DeepnoteFile, options: ExecutionOptions) => {
      await options.onBlockDone?.(
        blockResult({ success: false, error: new Error('boom'), outputs: [], executionCount: null })
      )
      return { ...SUMMARY, executedBlocks: 1, failedBlocks: 1 }
    })

    const result = await runWithInputs(NOTEBOOK, {})
    expect(result.summary.failedBlocks).toBe(1)
    expect(engineMock.stop).toHaveBeenCalledOnce()
  })

  it('persists a snapshot next to a path input by default (like deepnote run)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lr-run-'))
    writeFileSync(join(dir, 'nb.deepnote'), NOTEBOOK)
    try {
      const result = await runWithInputs(join(dir, 'nb.deepnote'), { count: 7 })
      expect(result.snapshotPath).toBeDefined()
      expect(existsSync(result.snapshotPath ?? '')).toBe(true)
      expect(readdirSync(join(dir, 'snapshots')).some(f => f.endsWith('.snapshot.deepnote'))).toBe(true)

      // What was written, not just that something was. The returned snapshot and the persisted one
      // are built from the same (file, outputs, timing) precisely so they cannot drift — which is
      // only worth anything if something checks. A write or serialization regression shows up here.
      const written = readFileSync(result.snapshotPath ?? '', 'utf8')
      expect(written).toBe(result.snapshotYaml)
      expect(written).toContain('output_type: stream') // the block's outputs really are inline
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects persistSnapshot:true for a path-less input before starting the engine', async () => {
    await expect(runWithInputs(NOTEBOOK, {}, { persistSnapshot: true })).rejects.toThrow(/requires a file path/)
    expect(engineMock.start).not.toHaveBeenCalled()
  })

  it('skips persistence when persistSnapshot is false, even for a path input', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lr-run-'))
    writeFileSync(join(dir, 'nb.deepnote'), NOTEBOOK)
    try {
      const result = await runWithInputs(join(dir, 'nb.deepnote'), { count: 7 }, { persistSnapshot: false })
      expect(result.snapshotPath).toBeUndefined()
      expect(existsSync(join(dir, 'snapshots'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
