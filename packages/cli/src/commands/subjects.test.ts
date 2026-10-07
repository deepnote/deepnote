import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { resetOutputConfig, setOutputConfig } from '../output'
import type { SubjectIndex } from '../utils/governance/subject-index'
import {
  createSubjectsIndexAction,
  createSubjectsLookupAction,
  SUBJECT_SALT_ENV,
  type SubjectsIndexOptions,
  type SubjectsLookupOptions,
} from './subjects'

/** The fixture workspace: four projects, two data subjects, one of them in two projects. */
const WORKSPACE = join('test-fixtures', 'workspace-audit')

const SALT = 'a-sufficiently-long-test-salt'
/** A subject the fixture holds, in two projects and in one saved output. */
const SCATTERED_SUBJECT = 'jane.doe@acme-corp.io'

function getOutput(spy: Mock<typeof console.log>): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n')
}

describe('subjects commands', () => {
  let program: Command
  let consoleSpy: Mock<typeof console.log>
  let consoleErrorSpy: Mock<typeof console.error>
  let exitSpy: Mock<typeof process.exit>
  let workDir: string
  let indexPath: string

  async function buildIndex(options: SubjectsIndexOptions = {}): Promise<void> {
    await createSubjectsIndexAction(program)(WORKSPACE, { out: indexPath, ...options })
  }

  async function readIndex(): Promise<SubjectIndex> {
    return JSON.parse(await readFile(indexPath, 'utf8')) as SubjectIndex
  }

  async function lookup(identifier: string, options: SubjectsLookupOptions = {}): Promise<void> {
    await createSubjectsLookupAction(program)(identifier, { index: indexPath, ...options })
  }

  beforeEach(async () => {
    program = new Command()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    resetOutputConfig()
    setOutputConfig({ color: false })
    vi.stubEnv(SUBJECT_SALT_ENV, SALT)
    workDir = await mkdtemp(join(tmpdir(), 'deepnote-subjects-'))
    indexPath = join(workDir, 'subjects.json')
  })

  afterEach(async () => {
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    exitSpy.mockRestore()
    vi.unstubAllEnvs()
    await rm(workDir, { recursive: true, force: true })
  })

  describe('subjects index', () => {
    it('writes an index of the people the workspace holds data about', async () => {
      await buildIndex({ internalDomain: ['globex.co'] })

      const index = await readIndex()
      expect(index.version).toBe(1)
      expect(index.summary).toMatchObject({ subjects: 2, locations: 5, scattered: 1 })
      expect(index.internalDomains).toEqual(['globex.co'])
      expect(getOutput(consoleSpy)).toContain('2 people in 5 locations')
    })

    it('never writes an address or the salt into the index', async () => {
      await buildIndex()

      const raw = await readFile(indexPath, 'utf8')
      expect(raw).not.toContain(SCATTERED_SUBJECT)
      expect(raw).not.toContain('acme-corp.io'.split('.')[0] + '@')
      expect(raw).not.toContain(SALT)
    })

    it('keeps the domain, which is a company rather than a person', async () => {
      await buildIndex()

      expect((await readIndex()).subjects.map(subject => subject.domain).sort()).toEqual(['acme-corp.io', 'globex.co'])
    })

    it('records locations in saved cell outputs, not just in code', async () => {
      await buildIndex()

      const sources = (await readIndex()).subjects.flatMap(subject => subject.locations.map(l => l.source))
      expect(sources).toContain('output')
      expect(sources).toContain('content')
    })

    it('is reproducible: the same workspace and salt give the same fingerprints', async () => {
      await buildIndex()
      const first = await readIndex()
      await buildIndex()
      const second = await readIndex()

      expect(second.subjects.map(s => s.fingerprint)).toEqual(first.subjects.map(s => s.fingerprint))
      expect(second.saltFingerprint).toBe(first.saltFingerprint)
    })

    it('produces different fingerprints under a different salt', async () => {
      await buildIndex()
      const first = await readIndex()
      vi.stubEnv(SUBJECT_SALT_ENV, `${SALT}-rotated`)
      await buildIndex()

      expect((await readIndex()).subjects.map(s => s.fingerprint)).not.toEqual(first.subjects.map(s => s.fingerprint))
    })

    it('reads the salt from a file when given one', async () => {
      const saltFile = join(workDir, 'salt')
      await writeFile(saltFile, `${SALT}\n`)
      vi.stubEnv(SUBJECT_SALT_ENV, '')

      await buildIndex({ saltFile })

      expect((await readIndex()).summary.subjects).toBe(2)
    })

    it('does not guess an internal domain when the evidence is a coin flip', async () => {
      await buildIndex()

      const output = getOutput(consoleSpy)
      expect((await readIndex()).internalDomains).toEqual([])
      expect(output).toContain('Unclassified')
      expect(output).not.toContain('Guessed')
    })

    it('refuses to build without a salt, and says why', async () => {
      vi.stubEnv(SUBJECT_SALT_ENV, '')

      await expect(buildIndex()).rejects.toThrow('process.exit called')

      const stderr = consoleErrorSpy.mock.calls.flat().join('\n')
      expect(stderr).toContain(SUBJECT_SALT_ENV)
      expect(stderr).toContain('enumerable space')
      expect(exitSpy).toHaveBeenCalledWith(2)
    })

    it('refuses a salt short enough to brute-force', async () => {
      vi.stubEnv(SUBJECT_SALT_ENV, 'short')

      await expect(buildIndex()).rejects.toThrow('process.exit called')
      expect(exitSpy).toHaveBeenCalledWith(2)
    })

    it('fails with invalid usage for a missing workspace', async () => {
      await expect(createSubjectsIndexAction(program)('no-such-directory', { out: indexPath })).rejects.toThrow(
        'process.exit called'
      )

      expect(exitSpy).toHaveBeenCalledWith(2)
    })

    it('reports the summary as JSON', async () => {
      await createSubjectsIndexAction(program)(WORKSPACE, { out: indexPath, output: 'json' })

      const report = JSON.parse(getOutput(consoleSpy))
      expect(report.summary.subjects).toBe(2)
      expect(report.path).toBe(indexPath)
      expect(report.saltFingerprint).toMatch(/^[0-9a-f]+$/)
      expect(JSON.stringify(report)).not.toContain(SALT)
    })
  })

  describe('subjects lookup', () => {
    beforeEach(async () => {
      await buildIndex({ internalDomain: ['globex.co'] })
      consoleSpy.mockClear()
    })

    it('lists every location holding data about the person', async () => {
      await lookup(SCATTERED_SUBJECT)

      const output = getOutput(consoleSpy)
      expect(output).toContain('Found in 2 notebooks across 2 projects')
      expect(output).toContain('marketing/campaigns.deepnote')
      expect(output).toContain('support/escalations.deepnote')
      expect(output).toContain('saved cell output')
    })

    it('does not echo the address it was asked about', async () => {
      await lookup(SCATTERED_SUBJECT)

      expect(getOutput(consoleSpy)).not.toContain(SCATTERED_SUBJECT)
    })

    it('matches a plus-tagged or differently-cased spelling of the same person', async () => {
      await lookup('Jane.Doe+Receipts@Acme-Corp.io')

      expect(getOutput(consoleSpy)).toContain('Found in 2 notebooks')
    })

    it('answers that a person is absent, and scopes the answer', async () => {
      await lookup('nobody@acme-corp.io')

      const output = getOutput(consoleSpy)
      expect(output).toContain('No locations recorded')
      expect(output).toContain('not in scope')
      expect(exitSpy).not.toHaveBeenCalled()
    })

    it('fails loudly on a salt mismatch instead of reporting no data held', async () => {
      vi.stubEnv(SUBJECT_SALT_ENV, `${SALT}-rotated`)

      await expect(lookup(SCATTERED_SUBJECT)).rejects.toThrow('process.exit called')

      const stderr = consoleErrorSpy.mock.calls.flat().join('\n')
      expect(stderr).toContain('built under a different salt')
      expect(stderr).toContain('Every lookup would come back empty')
      expect(exitSpy).toHaveBeenCalledWith(2)
    })

    it('rejects an identifier that is not a person', async () => {
      await expect(lookup('support@acme-corp.io')).rejects.toThrow('process.exit called')

      expect(consoleErrorSpy.mock.calls.flat().join('\n')).toContain('not an indexable subject')
      expect(exitSpy).toHaveBeenCalledWith(2)
    })

    it('points at the index builder when there is no index', async () => {
      await expect(lookup(SCATTERED_SUBJECT, { index: join(workDir, 'missing.json') })).rejects.toThrow(
        'process.exit called'
      )

      expect(consoleErrorSpy.mock.calls.flat().join('\n')).toContain('deepnote subjects index')
      expect(exitSpy).toHaveBeenCalledWith(2)
    })

    it('reports the result as JSON, with the fingerprint but not the address', async () => {
      await lookup(SCATTERED_SUBJECT, { output: 'json' })

      const report = JSON.parse(getOutput(consoleSpy))
      expect(report.found).toBe(true)
      expect(report.subject.notebookCount).toBe(2)
      expect(report.fingerprint).toMatch(/^[0-9a-f]{32}$/)
      expect(JSON.stringify(report)).not.toContain(SCATTERED_SUBJECT)
    })
  })
})
