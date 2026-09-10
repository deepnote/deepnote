import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DeepnoteFile } from '@deepnote/blocks'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  childProcesses,
  createToolkitLeakGuard,
  integrationPython,
  requireToolkit,
  type ToolkitLeakGuard,
} from '../../../test-helpers/integration-python'
import { ExecutionEngine } from './execution-engine'
import { ExecutionTimeoutError, KernelDiedError, ServerExitedError, ServerLaunchError } from './runtime-errors'
import type { BlockExecutionResult, ExecutionSummary } from './types'

/** A single-notebook project whose blocks are the given Python snippets, in order. */
function notebook(...codeBlocks: string[]): DeepnoteFile {
  return {
    version: '1.0.0',
    metadata: { createdAt: '2026-01-01T00:00:00.000Z' },
    project: {
      id: 'integration-project',
      name: 'Integration',
      notebooks: [
        {
          id: 'integration-notebook',
          name: 'Main',
          blocks: codeBlocks.map((content, index) => ({
            id: `block-${index + 1}`,
            blockGroup: `group-${index + 1}`,
            sortingKey: `a${index}`,
            type: 'code' as const,
            content,
            metadata: {},
            executionCount: null,
            outputs: [],
          })),
        },
      ],
    },
  }
}

async function run(
  engine: ExecutionEngine,
  file: DeepnoteFile
): Promise<{ summary: ExecutionSummary; results: BlockExecutionResult[]; elapsedMs: number }> {
  const results: BlockExecutionResult[] = []
  const started = Date.now()
  const summary = await engine.runProject(file, { onBlockDone: result => void results.push(result) })
  return { summary, results, elapsedMs: Date.now() - started }
}

describe('ExecutionEngine against a real deepnote-toolkit server', () => {
  const python = integrationPython()
  let workDir: string
  let leakGuard: ToolkitLeakGuard
  /** Toolkit server log of the current test, shown when the test leaves processes behind. */
  let serverLog: string[] = []
  const onServerLog = (stream: string, chunk: string) => {
    for (const line of chunk.split('\n')) {
      if (line.trim()) serverLog.push(`[server ${stream}] ${line}`)
    }
  }
  const config = (overrides: Record<string, unknown> = {}) => ({
    pythonEnv: python,
    workingDirectory: workDir,
    onServerLog,
    ...overrides,
  })

  beforeAll(async () => {
    requireToolkit(python)
    leakGuard = createToolkitLeakGuard(python)
    workDir = await mkdtemp(join(tmpdir(), 'deepnote-runtime-integration-'))
  })

  afterEach(async () => {
    const log = serverLog.slice(-25).join('\n')
    serverLog = []
    await leakGuard.assertNone(log ? `Toolkit server log of the test:\n${log}` : '')
  })

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it('runs code blocks in order and captures their outputs', async () => {
    const engine = new ExecutionEngine(config())
    await engine.start()
    try {
      const { summary, results } = await run(engine, notebook('x = 40 + 2', 'print(f"answer={x}")'))

      expect(summary).toMatchObject({ totalBlocks: 2, executedBlocks: 2, failedBlocks: 0 })
      expect(summary).not.toHaveProperty('failureCategory')
      expect(results.map(r => r.success)).toEqual([true, true])
      expect(JSON.stringify(results[1].outputs)).toContain('answer=42')
    } finally {
      await engine.stop()
    }
  })

  it('reports a raising block as an in-block failure and stops the run', async () => {
    const engine = new ExecutionEngine(config())
    await engine.start()
    try {
      const { summary, results } = await run(engine, notebook('raise ValueError("boom")', 'print("unreachable")'))

      expect(summary).toMatchObject({ totalBlocks: 2, executedBlocks: 1, failedBlocks: 1, failureCategory: 'in-block' })
      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({ success: false, failureCategory: 'in-block' })
      expect(JSON.stringify(results[0].outputs)).toContain('ValueError')
    } finally {
      await engine.stop()
    }
  })

  it('fails with kernel-died, instead of hanging, when the kernel process ends', async () => {
    const engine = new ExecutionEngine(config())
    await engine.start()
    try {
      const { summary, results, elapsedMs } = await run(
        engine,
        notebook('import os\nos._exit(1)', 'print("unreachable")')
      )

      expect(summary).toMatchObject({ failedBlocks: 1, failureCategory: 'kernel-died' })
      expect(results[0].error).toBeInstanceOf(KernelDiedError)
      expect(results[0].failureCategory).toBe('kernel-died')
      expect(elapsedMs).toBeLessThan(60_000)
    } finally {
      await engine.stop()
    }
  })

  it('fails with server-exited, instead of hanging, when the Jupyter server dies mid-run', async () => {
    const engine = new ExecutionEngine(config())
    await engine.start()
    const supervisorPid = engine.serverPid
    try {
      if (supervisorPid === null) throw new Error('server has no pid')
      const jupyter = childProcesses(supervisorPid).find(child => /jupyter/.test(child.command))
      if (!jupyter) throw new Error(`no Jupyter child under supervisor ${supervisorPid}`)

      const results: BlockExecutionResult[] = []
      const started = Date.now()
      // Kill the Jupyter server (not the toolkit supervisor) once the block is running, so the
      // websocket drops while an execution is in flight.
      const summary = await engine.runProject(notebook('import time\ntime.sleep(120)', 'print("unreachable")'), {
        onBlockStart: () => {
          setTimeout(() => process.kill(jupyter.pid, 'SIGKILL'), 1000)
        },
        onBlockDone: result => void results.push(result),
      })
      const elapsedMs = Date.now() - started

      expect(summary.failedBlocks).toBe(1)
      expect(results[0].success).toBe(false)
      expect(results[0].error).toBeInstanceOf(ServerExitedError)
      expect(summary.failureCategory).toBe('server-exited')
      expect(elapsedMs).toBeLessThan(60_000)
    } finally {
      await engine.stop()
      // Stopping the supervisor must take its remaining children (language server, kernels) with it.
      if (supervisorPid !== null) {
        await new Promise(resolve => setTimeout(resolve, 1000))
        expect(childProcesses(supervisorPid)).toEqual([])
      }
    }
  })

  it('interrupts a block that exceeds the block timeout', async () => {
    const engine = new ExecutionEngine(config({ blockTimeoutMs: 2000 }))
    await engine.start()
    try {
      const { summary, results, elapsedMs } = await run(
        engine,
        notebook('import time\ntime.sleep(60)', 'print("unreachable")')
      )

      expect(summary).toMatchObject({ executedBlocks: 1, failedBlocks: 1, failureCategory: 'execution-timeout' })
      expect(results[0].error).toBeInstanceOf(ExecutionTimeoutError)
      expect(elapsedMs).toBeLessThan(20_000)
    } finally {
      await engine.stop()
    }
  })

  it('names the missing toolkit, and fails fast, when the server cannot start', async () => {
    const bareVenv = join(workDir, 'bare-venv')
    execFileSync(python, ['-m', 'venv', '--without-pip', bareVenv], { stdio: 'ignore', timeout: 120_000 })
    const engine = new ExecutionEngine({ pythonEnv: bareVenv, workingDirectory: workDir })

    const started = Date.now()
    const error = await engine.start().catch(e => e)

    expect(error).toBeInstanceOf(ServerLaunchError)
    expect(error.category).toBe('server-launch')
    expect(error.message).toContain('deepnote-toolkit is not installed')
    expect(error.hint).toContain('pip install "deepnote-toolkit[server]"')
    expect(Date.now() - started).toBeLessThan(30_000)
  })
})
