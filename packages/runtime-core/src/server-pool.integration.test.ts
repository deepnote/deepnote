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
import { ExecutionEngine, type ExecutionOptions } from './execution-engine'
import { ServerPool } from './server-pool'
import type { BlockExecutionResult, ExecutionSummary } from './types'

/** A single-notebook project whose blocks are the given Python snippets, in order. */
function notebook(...codeBlocks: string[]): DeepnoteFile {
  return {
    version: '1.0.0',
    metadata: { createdAt: '2026-01-01T00:00:00.000Z' },
    project: {
      id: 'pool-integration-project',
      name: 'Pool integration',
      notebooks: [
        {
          id: 'pool-integration-notebook',
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
  file: DeepnoteFile,
  options: ExecutionOptions = {}
): Promise<{ summary: ExecutionSummary; results: BlockExecutionResult[] }> {
  const results: BlockExecutionResult[] = []
  const summary = await engine.runProject(file, { ...options, onBlockDone: result => void results.push(result) })
  return { summary, results }
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

describe('ServerPool against a real deepnote-toolkit server', () => {
  const python = integrationPython()
  let workDir: string
  let leakGuard: ToolkitLeakGuard

  beforeAll(async () => {
    requireToolkit(python)
    leakGuard = createToolkitLeakGuard(python)
    workDir = await mkdtemp(join(tmpdir(), 'deepnote-pool-integration-'))
  })

  afterEach(async () => {
    await leakGuard.assertNone()
  })

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it('runs two engines concurrently on one shared server without sharing a kernel', async () => {
    const pool = new ServerPool({ idleTimeoutMs: 0 })
    const serverOptions = { pythonEnv: python, workingDirectory: workDir }
    try {
      const [first, second] = await Promise.all([pool.acquire(serverOptions), pool.acquire(serverOptions)])
      expect(first.server).toBe(second.server)

      const engineA = new ExecutionEngine(serverOptions, { server: first.server })
      const engineB = new ExecutionEngine(serverOptions, { server: second.server })
      await Promise.all([engineA.start(), engineB.start()])
      try {
        // A defines a variable and keeps its kernel busy; B, on the same server, must not see it.
        const [a, b] = await Promise.all([
          run(engineA, notebook('marker = "A"\nimport time\ntime.sleep(3)\nprint(f"a sees {marker}")')),
          run(
            engineB,
            notebook('import time\ntime.sleep(1)\nprint("shared" if "marker" in globals() else "isolated")')
          ),
        ])

        expect(a.summary.failedBlocks).toBe(0)
        expect(b.summary.failedBlocks).toBe(0)
        expect(JSON.stringify(a.results[0].outputs)).toContain('a sees A')
        expect(JSON.stringify(b.results[0].outputs)).toContain('isolated')
      } finally {
        // Each engine shuts down only its own kernel; the other must be unaffected.
        await engineB.stop()
        const afterB = await run(engineA, notebook('print(f"still {marker}")'))
        expect(afterB.summary.failedBlocks).toBe(0)
        expect(JSON.stringify(afterB.results[0].outputs)).toContain('still A')
        await engineA.stop()
        first.release()
        second.release()
      }
    } finally {
      await pool.shutdown()
    }
  })

  it('replaces a pooled server whose Jupyter died and stops the old supervisor', async () => {
    const pool = new ServerPool({ idleTimeoutMs: 60_000 })
    const serverOptions = { pythonEnv: python, workingDirectory: workDir }
    try {
      const first = await pool.acquire(serverOptions)
      const supervisorPid = first.server.process.pid
      if (supervisorPid === undefined) throw new Error('server has no pid')
      const jupyter = childProcesses(supervisorPid).find(child => /jupyter/.test(child.command))
      if (!jupyter) throw new Error(`no Jupyter child under supervisor ${supervisorPid}`)

      const engine = new ExecutionEngine(serverOptions, { server: first.server })
      await engine.start()
      const { summary } = await run(engine, notebook('import time\ntime.sleep(120)'), {
        onBlockStart: () => {
          setTimeout(() => process.kill(jupyter.pid, 'SIGKILL'), 1000)
        },
      })
      expect(summary.failureCategory).toBe('server-exited')
      await engine.stop()
      first.release()

      // The supervisor is still alive, but the next lease must not get this broken server.
      expect(first.server.process.exitCode).toBeNull()
      const second = await pool.acquire(serverOptions)
      expect(second.server).not.toBe(first.server)
      expect(second.server.process.pid).not.toBe(supervisorPid)
      await waitFor(() => first.server.process.exitCode !== null, 15_000)

      const recovered = new ExecutionEngine(serverOptions, { server: second.server })
      await recovered.start()
      const ok = await run(recovered, notebook('print("recovered")'))
      expect(ok.summary.failedBlocks).toBe(0)
      expect(JSON.stringify(ok.results[0].outputs)).toContain('recovered')
      await recovered.stop()
      second.release()
    } finally {
      await pool.shutdown()
    }
  })
})
