import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ProjectSyncOutcome, SyncConflict, SyncEvent, WorkspaceSyncResult } from '@deepnote/cloud-sync'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepnote/cloud-sync', async importOriginal => {
  const actual = await importOriginal<typeof import('@deepnote/cloud-sync')>()
  return { ...actual, syncWorkspace: vi.fn() }
})
vi.mock('@inquirer/prompts', async importOriginal => {
  const actual = await importOriginal<typeof import('@inquirer/prompts')>()
  return { ...actual, select: vi.fn() }
})

import { syncWorkspace } from '@deepnote/cloud-sync'
import { select } from '@inquirer/prompts'
import { createProgram } from '../cli'
import { resetOutputConfig } from '../output'
import { runSync } from './sync'

const mockedSyncWorkspace = vi.mocked(syncWorkspace)
const mockedSelect = vi.mocked(select)

const NO_TERMINAL_NOTE =
  '[debug] No interactive terminal; conflicts will be skipped. Use --on-conflict to decide up front.'

let tempDir: string
let logged: string[]
let errored: string[]
let priorStdinTty: PropertyDescriptor | undefined
let priorStdoutTty: PropertyDescriptor | undefined

function setTty(stdin: boolean, stdout: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { value: stdin, configurable: true })
  Object.defineProperty(process.stdout, 'isTTY', { value: stdout, configurable: true })
}

function restoreTty(stream: NodeJS.ReadStream | NodeJS.WriteStream, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(stream, 'isTTY', descriptor)
  else Reflect.deleteProperty(stream, 'isTTY')
}

function resultOf(overrides: Partial<WorkspaceSyncResult> = {}): WorkspaceSyncResult {
  return { success: true, root: '/sync/root', dryRun: false, projects: [], untrackedFiles: [], ...overrides }
}

/** Runs the real `deepnote` program, so flag registration in `cli.ts` is part of what is tested. */
function deepnote(...args: string[]): Promise<unknown> {
  return createProgram().parseAsync(['node', 'deepnote', '--no-color', ...args])
}

function sync(...flags: string[]): Promise<unknown> {
  return deepnote('sync', tempDir, '--token', 'tok', ...flags)
}

/** `process.exit` throws so the action stops where Commander would have exited. */
function interceptExit() {
  return vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('exit')
  })
}

function captureProcessStderr(): string[] {
  const written: string[] = []
  vi.spyOn(process.stderr, 'write').mockImplementation(chunk => {
    written.push(String(chunk))
    return true
  })
  return written
}

/** The options of the only `syncWorkspace` call. */
function syncedWith() {
  expect(mockedSyncWorkspace).toHaveBeenCalledTimes(1)
  return mockedSyncWorkspace.mock.calls[0][0]
}

function askFunction() {
  const policy = syncedWith().onConflict
  if (typeof policy !== 'function') {
    throw new Error(`Expected a function policy, got ${String(policy)}`)
  }
  return policy
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-cli-test-'))
  logged = []
  errored = []
  vi.spyOn(console, 'log').mockImplementation(message => {
    logged.push(String(message))
  })
  vi.spyOn(console, 'error').mockImplementation(message => {
    errored.push(String(message))
  })
  priorStdinTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')
  priorStdoutTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
  setTty(false, false)
  vi.stubEnv('DEEPNOTE_TOKEN', undefined)
  process.exitCode = undefined
  mockedSyncWorkspace.mockReset().mockResolvedValue(resultOf())
  mockedSelect.mockReset()
})

afterEach(async () => {
  process.exitCode = undefined
  restoreTty(process.stdin, priorStdinTty)
  restoreTty(process.stdout, priorStdoutTty)
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  resetOutputConfig()
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('deepnote sync conflict policy', () => {
  it.each(['skip', 'override'] as const)('passes --on-conflict %s through, even on a terminal', async mode => {
    setTty(true, true)

    await sync('--on-conflict', mode)

    expect(syncedWith().onConflict).toBe(mode)
    expect(mockedSelect).not.toHaveBeenCalled()
  })

  const conflictCases = [
    {
      conflict: { kind: 'empty-local-directory', projectId: 'p1', projectName: 'Alpha' },
      question:
        'The local directory for "Alpha" has no notebooks. Pushing it with --delete-missing-notebooks deletes every notebook in the cloud project. Push anyway?',
      overrideLabel: 'Push and delete every notebook in the cloud project',
      answer: 'skip',
    },
    {
      conflict: { kind: 'cloud-changed-after-local-edit', projectId: 'p1', projectName: 'Alpha' },
      question: '"Alpha" changed in Deepnote after your local edit. Overwrite the cloud version with your local files?',
      overrideLabel: 'Overwrite the cloud version with the local files',
      answer: 'override',
    },
    {
      conflict: {
        kind: 'working-files-changed',
        projectId: 'p1',
        projectName: 'Alpha',
        projectDir: 'Team/Alpha',
        files: [
          { path: '_deepnote_static/index.html', reason: 'changed in Deepnote' },
          { path: 'data.csv', reason: 'was deleted in Deepnote' },
        ],
      },
      question:
        'Working files of "Alpha" changed in Deepnote since the last sync: ' +
        '_deepnote_static/index.html (changed in Deepnote), data.csv (was deleted in Deepnote). ' +
        'Overwrite the Deepnote copies with your local files?',
      overrideLabel: 'Overwrite the Deepnote copies with the local files',
      answer: 'skip',
    },
    {
      conflict: { kind: 'changed-on-both-sides', projectId: 'p1', projectName: 'Alpha', projectDir: 'Team/Alpha' },
      question: '"Alpha" changed both locally and in Deepnote. Overwrite the local files with the cloud version?',
      overrideLabel: 'Overwrite the local files with the cloud version (discards local changes)',
      answer: 'override',
    },
    {
      conflict: { kind: 'untracked-local-directory', projectId: 'p1', projectName: 'Alpha', projectDir: 'Team/Alpha' },
      question:
        'Team/Alpha exists locally but is not linked to "Alpha" in Deepnote. Overwrite it with the cloud version?',
      overrideLabel: 'Overwrite the local files with the cloud version (discards local changes)',
      answer: 'skip',
    },
  ] satisfies { conflict: SyncConflict; question: string; overrideLabel: string; answer: 'skip' | 'override' }[]

  it.each(conflictCases)(
    'asks about $conflict.kind on a terminal with the question and labels it always used',
    async ({ conflict, question, overrideLabel, answer }) => {
      setTty(true, true)
      mockedSelect.mockResolvedValueOnce(answer)

      await sync()
      const decision = await askFunction()(conflict)

      expect(decision).toBe(answer)
      expect(mockedSelect).toHaveBeenCalledTimes(1)
      expect(mockedSelect).toHaveBeenCalledWith({
        message: question,
        choices: [
          { name: 'Skip this project for now', value: 'skip' },
          { name: overrideLabel, value: 'override' },
        ],
      })
    }
  )

  it('asks when --on-conflict ask is explicit', async () => {
    setTty(true, true)

    await sync('--on-conflict', 'ask')

    expect(typeof syncedWith().onConflict).toBe('function')
  })

  it.each([
    ['no stdin terminal', true, false],
    ['no stdout terminal', false, true],
    ['no terminal at all', false, false],
  ])('skips conflicts and says so with debug output when there is %s', async (_name, stdinTty, stdoutTty) => {
    setTty(stdinTty, stdoutTty)

    await deepnote('--debug', 'sync', tempDir, '--token', 'tok')

    expect(syncedWith().onConflict).toBe('skip')
    expect(errored).toEqual([NO_TERMINAL_NOTE])
  })

  it('skips conflicts under -o json even on a terminal, and says so with debug output', async () => {
    setTty(true, true)

    await deepnote('--debug', 'sync', tempDir, '--token', 'tok', '-o', 'json')

    expect(syncedWith().onConflict).toBe('skip')
    expect(errored).toEqual([NO_TERMINAL_NOTE])
  })

  it('hands a function to the library in a dry run on a terminal, without the no-terminal note', async () => {
    setTty(true, true)

    await deepnote('--debug', 'sync', tempDir, '--token', 'tok', '--dry-run')

    expect(typeof syncedWith().onConflict).toBe('function')
    expect(errored).toEqual([])
  })

  it('does not print the no-terminal note for an explicit mode without a terminal', async () => {
    await deepnote('--debug', 'sync', tempDir, '--token', 'tok', '--on-conflict', 'override')

    expect(syncedWith().onConflict).toBe('override')
    expect(errored).toEqual([])
  })
})

describe('deepnote sync events', () => {
  const outcome = { projectId: 'p1', name: 'Alpha', path: 'Team/Alpha' } as const

  function emitAll(events: SyncEvent[]): void {
    mockedSyncWorkspace.mockImplementation(async options => {
      for (const event of events) {
        options.onEvent?.(event)
      }
      return resultOf()
    })
  }

  it('prints the listing line and one line per project outcome', async () => {
    emitAll([
      { kind: 'listing-projects', baseUrl: 'https://api.example.com' },
      { kind: 'project-outcome', outcome: { ...outcome, action: 'pulled', detail: 'moved from Old/Alpha' } },
    ])

    await sync('--url', 'https://api.example.com')

    expect(logged).toEqual([
      'Listing projects from https://api.example.com…',
      '↓ pulled    Team/Alpha — moved from Old/Alpha',
      '',
      '0 pulled, 0 unchanged',
    ])
  })

  const outcomeLines: { outcome: ProjectSyncOutcome; line: string }[] = [
    { outcome: { ...outcome, action: 'pulled' }, line: '↓ pulled    Team/Alpha' },
    {
      outcome: {
        ...outcome,
        action: 'pushed',
        notebooks: [
          { id: 'n1', name: 'Main', action: 'updated' },
          { id: 'n2', name: 'Extra', action: 'created' },
        ],
        detail: 'moved from Old/Alpha',
      },
      line: '↑ pushed    Team/Alpha — Main: updated, Extra: created — moved from Old/Alpha',
    },
    { outcome: { ...outcome, action: 'unchanged' }, line: '· unchanged Team/Alpha' },
    {
      outcome: { ...outcome, action: 'skipped-conflict', detail: 'modified both locally and in the cloud' },
      line: '⚠ skipped   Team/Alpha — modified both locally and in the cloud',
    },
    {
      outcome: { ...outcome, action: 'pruned', detail: 'no longer in the cloud; removed locally (--prune)' },
      line: '✕ pruned    Team/Alpha — no longer in the cloud; removed locally (--prune)',
    },
    {
      outcome: {
        ...outcome,
        action: 'missing-in-cloud',
        detail: 'no longer in the cloud; kept locally (use --prune to remove)',
      },
      line: '? missing   Team/Alpha — no longer in the cloud; kept locally (use --prune to remove)',
    },
    { outcome: { ...outcome, action: 'error', detail: 'boom' }, line: '✗ error     Team/Alpha — boom' },
  ]

  it.each(outcomeLines)(
    'renders a $outcome.action outcome as its progress line',
    async ({ outcome: projectOutcome, line }) => {
      emitAll([{ kind: 'project-outcome', outcome: projectOutcome }])

      await sync()

      expect(logged[0]).toBe(line)
    }
  )

  it('suppresses the listing and outcome lines under -o json, leaving the JSON document alone on stdout', async () => {
    emitAll([
      { kind: 'listing-projects', baseUrl: 'https://api.example.com' },
      { kind: 'project-outcome', outcome: { ...outcome, action: 'pulled' } },
    ])

    await sync('-o', 'json')

    expect(logged).toEqual([
      [
        '{',
        '  "success": true,',
        '  "root": "/sync/root",',
        '  "dryRun": false,',
        '  "projects": [],',
        '  "untrackedFiles": []',
        '}',
      ].join('\n'),
    ])
  })

  it.each([[[]], [['-o', 'json']]])('sends a warning to stderr verbatim (flags %j)', async flags => {
    emitAll([{ kind: 'warning', message: 'Skipping file with unsafe path in "C": ../evil.csv' }])

    await sync(...flags)

    expect(errored).toEqual(['Skipping file with unsafe path in "C": ../evil.csv'])
  })

  it('reports file transfers as debug output only', async () => {
    emitAll([
      { kind: 'file-transferred', direction: 'download', projectName: 'Alpha', path: 'data/a.csv', bytes: 12 },
      {
        kind: 'file-transferred',
        direction: 'upload',
        projectName: 'Alpha',
        path: '_deepnote_static/index.html',
        bytes: 34,
      },
    ])

    await sync()
    expect(errored).toEqual([])

    await deepnote('--debug', 'sync', tempDir, '--token', 'tok', '--on-conflict', 'skip')
    expect(errored).toEqual([
      '[debug] Downloaded Alpha: data/a.csv (12 bytes)',
      '[debug] Uploaded Alpha: _deepnote_static/index.html (34 bytes)',
    ])
  })
})

describe('deepnote sync arguments', () => {
  it('passes every flag to the library, with the directory as rootDir and --url as baseUrl', async () => {
    await deepnote(
      'sync',
      tempDir,
      '--url',
      'https://staging.example.com',
      '--token',
      'flag-token',
      '--all-files',
      '--on-conflict',
      'override',
      '--delete-missing-notebooks',
      '--prune',
      '--dry-run',
      '--concurrency',
      '3'
    )

    expect(syncedWith()).toEqual({
      rootDir: tempDir,
      baseUrl: 'https://staging.example.com',
      token: 'flag-token',
      allFiles: true,
      deleteMissingNotebooks: true,
      prune: true,
      dryRun: true,
      concurrency: 3,
      onConflict: 'override',
      onEvent: expect.any(Function),
    })
  })

  it('uses the default API URL, the default concurrency and no optional flags', async () => {
    await sync()

    expect(syncedWith()).toStrictEqual({
      rootDir: tempDir,
      baseUrl: 'https://api.deepnote.com',
      token: 'tok',
      allFiles: undefined,
      deleteMissingNotebooks: undefined,
      prune: undefined,
      dryRun: undefined,
      concurrency: 8,
      onConflict: 'skip',
      onEvent: expect.any(Function),
    })
  })

  it('resolves a relative directory against the working directory', async () => {
    await deepnote('sync', path.relative(process.cwd(), tempDir), '--token', 'tok')

    expect(syncedWith().rootDir).toBe(tempDir)
  })

  it('falls back to the working directory and the default API URL when called without them', async () => {
    await runSync(undefined, { token: 'tok', dryRun: true })

    expect(syncedWith().rootDir).toBe(process.cwd())
    expect(syncedWith().baseUrl).toBe('https://api.deepnote.com')
  })

  it('reads the token from <root>/.env', async () => {
    await fs.writeFile(path.join(tempDir, '.env'), 'DEEPNOTE_TOKEN=env-token\n')

    await deepnote('sync', tempDir)

    expect(syncedWith().token).toBe('env-token')
  })

  it('prefers --token over <root>/.env', async () => {
    await fs.writeFile(path.join(tempDir, '.env'), 'DEEPNOTE_TOKEN=env-token\n')

    await deepnote('sync', tempDir, '--token', 'flag-token')

    expect(syncedWith().token).toBe('flag-token')
  })

  it('creates the root before syncing, unless it is a dry run', async () => {
    const created = path.join(tempDir, 'created')
    const notCreated = path.join(tempDir, 'not-created')

    await deepnote('sync', created, '--token', 'tok')
    await deepnote('sync', notCreated, '--token', 'tok', '--dry-run')

    expect((await fs.stat(created)).isDirectory()).toBe(true)
    await expect(fs.access(notCreated)).rejects.toThrow()
  })
})

describe('deepnote sync result handling', () => {
  const failing = resultOf({
    success: false,
    projects: [
      { projectId: 'p1', name: 'A', path: 'A', action: 'pulled', filesDownloaded: 3 },
      { projectId: 'p2', name: 'B', path: 'B', action: 'pulled', filesDownloaded: 1 },
      { projectId: 'p3', name: 'C', path: 'C', action: 'pushed', filesUploaded: 2 },
      { projectId: 'p4', name: 'D', path: 'D', action: 'unchanged' },
      { projectId: 'p5', name: 'E', path: 'E', action: 'unchanged' },
      { projectId: 'p6', name: 'F', path: 'F', action: 'unchanged' },
      { projectId: 'p7', name: 'G', path: 'G', action: 'skipped-conflict', filesSkipped: 1 },
      { projectId: 'p8', name: 'H', path: 'H', action: 'error', detail: 'boom' },
    ],
  })

  it('prints the counts summary, and sets exit code 1 for an unsuccessful result without throwing', async () => {
    mockedSyncWorkspace.mockResolvedValue(failing)

    await sync()

    expect(logged).toEqual([
      '',
      '2 pulled, 1 pushed, 3 unchanged, 1 skipped, 1 failed, 4 file(s) downloaded, 2 file(s) uploaded, 1 file(s) kept from Deepnote',
    ])
    expect(process.exitCode).toBe(1)
  })

  it('prints the dry-run prefix and the untracked-files line, and leaves the exit code alone on success', async () => {
    mockedSyncWorkspace.mockResolvedValue(
      resultOf({
        dryRun: true,
        projects: [
          { projectId: 'p1', name: 'A', path: 'A', action: 'pulled' },
          { projectId: 'p2', name: 'B', path: 'B', action: 'unchanged' },
          { projectId: 'p3', name: 'C', path: 'C', action: 'unchanged' },
        ],
        untrackedFiles: ['loose.deepnote', 'other/notes.deepnote'],
      })
    )

    await sync('--dry-run')

    expect(logged).toEqual([
      '',
      'Dry run — 1 pulled, 2 unchanged',
      'Untracked local .deepnote files (no matching cloud project): loose.deepnote, other/notes.deepnote. ' +
        'Sync does not create cloud projects; use `deepnote open` to import one.',
    ])
    expect(process.exitCode).toBeUndefined()
  })

  it('prints the result once as 2-space-indented JSON and no summary under -o json', async () => {
    mockedSyncWorkspace.mockResolvedValue(
      resultOf({
        dryRun: true,
        projects: [{ projectId: 'p1', name: 'A', path: 'Team/A', action: 'pulled' }],
        untrackedFiles: ['loose.deepnote'],
      })
    )

    await sync('-o', 'json', '--dry-run')

    expect(logged).toEqual([
      [
        '{',
        '  "success": true,',
        '  "root": "/sync/root",',
        '  "dryRun": true,',
        '  "projects": [',
        '    {',
        '      "projectId": "p1",',
        '      "name": "A",',
        '      "path": "Team/A",',
        '      "action": "pulled"',
        '    }',
        '  ],',
        '  "untrackedFiles": [',
        '    "loose.deepnote"',
        '  ]',
        '}',
      ].join('\n'),
    ])
  })

  it('still sets exit code 1 for an unsuccessful result under -o json', async () => {
    mockedSyncWorkspace.mockResolvedValue(failing)

    await sync('-o', 'json')

    expect(process.exitCode).toBe(1)
  })

  it('fails with exit code 2 and the missing-token message, without calling the library', async () => {
    const exit = interceptExit()
    const written = captureProcessStderr()

    await expect(deepnote('sync', tempDir)).rejects.toThrow('exit')

    expect(exit).toHaveBeenCalledWith(2)
    expect(written.join('').startsWith('Missing authentication token.\n')).toBe(true)
    expect(mockedSyncWorkspace).not.toHaveBeenCalled()
  })

  it.each([
    ['an Error', new Error('Refusing to prune because nothing matches'), 'Refusing to prune because nothing matches'],
    ['a non-Error value', 'plain failure', 'plain failure'],
  ])('fails with exit code 1 and the message when the library rejects with %s', async (_name, rejection, message) => {
    mockedSyncWorkspace.mockRejectedValue(rejection)
    const exit = interceptExit()
    const written = captureProcessStderr()

    await expect(sync()).rejects.toThrow('exit')

    expect(exit).toHaveBeenCalledWith(1)
    expect(written.join('')).toBe(`${message}\n`)
  })

  it('fails with exit code 1 and the prompt message when Ctrl+C closes a conflict prompt', async () => {
    setTty(true, true)
    const ctrlC = Object.assign(new Error('User force closed the prompt'), { name: 'ExitPromptError' })
    mockedSelect.mockRejectedValueOnce(ctrlC)
    mockedSyncWorkspace.mockImplementation(async options => {
      if (typeof options.onConflict !== 'function') {
        throw new Error('Expected a function policy')
      }
      await options.onConflict({
        kind: 'changed-on-both-sides',
        projectId: 'p1',
        projectName: 'Alpha',
        projectDir: 'Alpha',
      })
      return resultOf()
    })
    const exit = interceptExit()
    const written = captureProcessStderr()

    await expect(sync()).rejects.toThrow('exit')

    expect(exit).toHaveBeenCalledWith(1)
    expect(written.join('')).toBe('User force closed the prompt\n')
  })
})
