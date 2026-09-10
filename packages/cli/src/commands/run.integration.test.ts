import { execFile, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { serializeDeepnoteFile } from '@deepnote/blocks'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  createToolkitLeakGuard,
  integrationPython,
  requireToolkit,
  type ToolkitLeakGuard,
} from '../../../../test-helpers/integration-python'

const repoRoot = resolve(__dirname, '../../../..')
const cliBin = join(repoRoot, 'packages/cli/dist/bin.js')

interface CliRun {
  code: number
  stdout: string
  stderr: string
  elapsedMs: number
}

/** stderr of the most recent CLI run, so a leak found afterwards can be traced to the toolkit server log. */
let lastCliStderr = ''

function runCli(args: string[], env: Record<string, string> = {}): Promise<CliRun> {
  const started = Date.now()
  return new Promise(resolvePromise => {
    // --debug forwards the toolkit server's own log to stderr.
    execFile(
      process.execPath,
      [cliBin, '--debug', ...args],
      { env: { ...process.env, ...env }, timeout: 170_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 0
        lastCliStderr = stderr
        void resolvePromise({ code, stdout, stderr, elapsedMs: Date.now() - started })
      }
    )
  })
}

function codeNotebook(...codeBlocks: string[]): string {
  return serializeDeepnoteFile({
    version: '1.0.0',
    metadata: { createdAt: '2026-01-01T00:00:00.000Z' },
    project: {
      id: 'cli-integration-project',
      name: 'CLI integration',
      notebooks: [
        {
          id: 'cli-integration-notebook',
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
  })
}

describe('deepnote run against a real deepnote-toolkit server', () => {
  const python = integrationPython()
  let workDir: string
  let leakGuard: ToolkitLeakGuard

  beforeAll(async () => {
    requireToolkit(python)
    if (!existsSync(cliBin)) {
      throw new Error(`${cliBin} is missing; build the CLI first with pnpm build.`)
    }
    leakGuard = createToolkitLeakGuard(python)
    workDir = await mkdtemp(join(tmpdir(), 'deepnote-cli-integration-'))
  })

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  afterEach(async () => {
    // A finished CLI run must not leave a toolkit server, language server or kernel behind.
    const serverLog = lastCliStderr
      .split('\n')
      .filter(line => line.includes('[server '))
      .slice(-25)
      .join('\n')
    await leakGuard.assertNone(serverLog ? `Toolkit server log of the last run:\n${serverLog}` : '')
  })

  it('runs a notebook end to end and reports every block in JSON', async () => {
    const file = join(workDir, 'simple.deepnote')
    await copyFile(join(repoRoot, 'test-fixtures', 'simple.deepnote'), file)

    const result = await runCli(['run', file, '-o', 'json'], { DEEPNOTE_PYTHON: python })

    expect(result.code).toBe(0)
    const parsed = JSON.parse(result.stdout)
    expect(parsed).toMatchObject({ success: true, totalBlocks: 2, executedBlocks: 2, failedBlocks: 0 })
    expect(parsed).not.toHaveProperty('failureCategory')
    expect(JSON.stringify(parsed.blocks[0].outputs)).toContain('Hello, World!')
    expect(JSON.stringify(parsed.blocks[1].outputs)).toContain('3')
  })

  it('exits 1 with failureCategory in-block when a block raises', async () => {
    const file = join(workDir, 'raising.deepnote')
    await writeFile(file, codeNotebook('raise RuntimeError("boom")', 'print("unreachable")'))

    const result = await runCli(['run', file, '-o', 'json'], { DEEPNOTE_PYTHON: python })

    expect(result.code).toBe(1)
    const parsed = JSON.parse(result.stdout)
    expect(parsed).toMatchObject({ success: false, executedBlocks: 1, failedBlocks: 1, failureCategory: 'in-block' })
    expect(parsed.blocks[0].failureCategory).toBe('in-block')
    expect(parsed).not.toHaveProperty('hint')
  })

  it('interrupts a long block with --block-timeout and reports execution-timeout', async () => {
    const file = join(workDir, 'slow.deepnote')
    await writeFile(file, codeNotebook('import time\ntime.sleep(60)', 'print("unreachable")'))

    const result = await runCli(['run', file, '--block-timeout', '2', '-o', 'json'], { DEEPNOTE_PYTHON: python })

    expect(result.code).toBe(1)
    const parsed = JSON.parse(result.stdout)
    expect(parsed).toMatchObject({ success: false, failedBlocks: 1, failureCategory: 'execution-timeout' })
    expect(parsed.blocks[0].failureCategory).toBe('execution-timeout')
    expect(parsed.hint).toContain('block timeout')
    expect(result.elapsedMs).toBeLessThan(60_000)
  })

  it('fails fast with failureCategory server-launch and an install hint when the toolkit is missing', async () => {
    const bareVenv = join(workDir, 'bare-venv')
    execFileSync(python, ['-m', 'venv', '--without-pip', bareVenv], { stdio: 'ignore', timeout: 120_000 })
    const file = join(workDir, 'hello.deepnote')
    await writeFile(file, codeNotebook('print("hi")'))

    const result = await runCli(['run', file, '--python', bareVenv, '-o', 'json'])

    expect(result.code).toBe(1)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.success).toBe(false)
    expect(parsed.failureCategory).toBe('server-launch')
    expect(parsed.error).toContain('deepnote-toolkit is not installed')
    expect(parsed.hint).toContain('pip install "deepnote-toolkit[server]"')
    // The process must exit promptly instead of polling the dead server until the startup timeout.
    expect(result.elapsedMs).toBeLessThan(30_000)
  })
})
