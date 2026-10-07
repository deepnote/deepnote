import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { resetOutputConfig, setOutputConfig } from '../output'
import { type AuditOptions, createAuditAction, describeNearest } from './audit'

/** A four-project synced workspace with one of every workspace-scoped finding. */
const WORKSPACE = join('test-fixtures', 'workspace-audit')

/** The secret the fixture hardcodes in two projects. It must never reach the output. */
const FIXTURE_SECRET = '9f8e7d6c5b4a39281706'

const DEFAULT_OPTIONS: AuditOptions = {}

function getOutput(spy: Mock<typeof console.log>): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n')
}

describe('audit command', () => {
  let program: Command
  let consoleSpy: Mock<typeof console.log>
  let consoleErrorSpy: Mock<typeof console.error>
  let exitSpy: Mock<typeof process.exit>

  beforeEach(() => {
    program = new Command()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    resetOutputConfig()
    setOutputConfig({ color: false })
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    exitSpy.mockRestore()
  })

  describe('text output', () => {
    it('reports the inventory, ingress, egress, and findings', async () => {
      await createAuditAction(program)(WORKSPACE, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('4 projects, 4 notebooks')
      expect(output).toContain('Ingress — integrations')
      expect(output).toContain('Warehouse (snowflake)')
      expect(output).toContain('Egress — external hosts')
      expect(output).toContain('api.segment.io')
      expect(output).toContain('Findings')
    })

    it('marks an integration declared but used by nobody', async () => {
      await createAuditAction(program)(WORKSPACE, DEFAULT_OPTIONS)

      expect(getOutput(consoleSpy)).toContain('Legacy Redshift (redshift) — declared in 1 project, used by none')
    })

    it('names the credential shared across projects by fingerprint only', async () => {
      await createAuditAction(program)(WORKSPACE, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('Credentials shared across projects')
      expect(output).toContain('Marketing campaigns, Revenue reporting')
      expect(output).not.toContain(FIXTURE_SECRET)
    })

    it('states the limits of what it measured', async () => {
      await createAuditAction(program)(WORKSPACE, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('Egress is a lower bound')
      expect(output).toContain('Divergence checks need roughly')
      expect(output).toContain('This workspace has 4 projects')
    })

    it('summarizes findings by check, and lists them with --issues', async () => {
      await createAuditAction(program)(WORKSPACE, DEFAULT_OPTIONS)
      const summary = getOutput(consoleSpy)
      consoleSpy.mockClear()
      await createAuditAction(program)(WORKSPACE, { issues: true })
      const listed = getOutput(consoleSpy)

      expect(summary).toContain('egress-external: 5 in 2 projects')
      expect(summary).toContain('Run with --issues')
      expect(listed).toContain('This block writes to api.segment.io')
      expect(listed).not.toContain('Run with --issues')
    })

    it('exits 0 even with findings — an audit is an inventory, not a gate', async () => {
      await createAuditAction(program)(WORKSPACE, DEFAULT_OPTIONS)

      expect(exitSpy).not.toHaveBeenCalled()
    })
  })

  describe('data subjects', () => {
    it('counts the people the workspace holds data about, and how far they are spread', async () => {
      await createAuditAction(program)(WORKSPACE, { internalDomain: ['globex.co'] })

      const output = getOutput(consoleSpy)
      expect(output).toContain('Data subjects')
      expect(output).toContain('2 people in 5 locations, 1 external')
      expect(output).toContain('1 person appears in more than one notebook')
      expect(output).toContain('pii-subject-scatter')
    })

    it('never names the person, in text or in JSON', async () => {
      await createAuditAction(program)(WORKSPACE, DEFAULT_OPTIONS)
      const text = getOutput(consoleSpy)
      consoleSpy.mockClear()
      await createAuditAction(program)(WORKSPACE, { output: 'json' })

      expect(text).not.toContain('jane.doe@acme-corp.io')
      expect(getOutput(consoleSpy)).not.toContain('jane.doe@acme-corp.io')
    })

    it('says that nobody was classified when no internal domain was given', async () => {
      await createAuditAction(program)(WORKSPACE, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('pass --internal-domain')
      expect(output).toContain('No --internal-domain was given')
    })

    it('reports the scatter finding without a fingerprint, which would be per-run', async () => {
      await createAuditAction(program)(WORKSPACE, { output: 'json' })

      const report = JSON.parse(getOutput(consoleSpy))
      const scatter = report.issues.find((issue: { code: string }) => issue.code === 'pii-subject-scatter')
      expect(scatter.details).toMatchObject({ domain: 'acme-corp.io', notebookCount: 2, projectCount: 2 })
      expect(scatter.details.fingerprint).toBeUndefined()
      expect(report.subjects).toMatchObject({ total: 2, scattered: 1 })
    })
  })

  describe('--project', () => {
    it('restricts the report to one project', async () => {
      await createAuditAction(program)(WORKSPACE, { project: 'Revenue reporting' })

      const output = getOutput(consoleSpy)
      expect(output).toContain('1 project, 1 notebook')
      expect(output).toContain('Filtered to one project')
      expect(output).not.toContain('s3://marketing-exports')
    })

    it('matches a project id', async () => {
      await createAuditAction(program)(WORKSPACE, { project: '33333333-3333-4333-8333-333333333333' })

      expect(getOutput(consoleSpy)).toContain('1 project, 1 notebook')
    })

    it('fails with invalid usage and offers the nearest name when the name is close', async () => {
      await expect(createAuditAction(program)(WORKSPACE, { project: 'Marketing' })).rejects.toThrow(
        'process.exit called'
      )

      const stderr = consoleErrorSpy.mock.calls.flat().join('\n')
      expect(stderr).toContain('Project "Marketing" not found')
      expect(stderr).toContain('"Marketing campaigns"')
      expect(exitSpy).toHaveBeenCalledWith(2)
    })

    it('does not list the whole workspace when the name resembles nothing', async () => {
      await expect(createAuditAction(program)(WORKSPACE, { project: 'Nope' })).rejects.toThrow('process.exit called')

      const stderr = consoleErrorSpy.mock.calls.flat().join('\n')
      expect(stderr).toContain('Project "Nope" not found')
      // Listing every project was the old behaviour: unreadable on a real workspace, and a
      // needless disclosure in a CI log, where the names themselves can be the sensitive part.
      expect(stderr).not.toContain('"Marketing campaigns"')
      // Not the exact count: later branches add projects to this fixture, and what matters is
      // that the message reports a total instead of enumerating it.
      expect(stderr).toMatch(/\d+ projects in this workspace/)
      expect(exitSpy).toHaveBeenCalledWith(2)
    })
  })

  describe('-o json output', () => {
    it('emits the full report, including the flow map', async () => {
      await createAuditAction(program)(WORKSPACE, { output: 'json' })

      const report = JSON.parse(getOutput(consoleSpy))
      expect(report.scope).toBe('workspace')
      expect(report.summary.projects).toBe(4)
      expect(report.integrations).toHaveLength(3)
      expect(report.credentials).toHaveLength(1)
      expect(report.flow.nodes.filter((n: { kind: string }) => n.kind === 'project')).toHaveLength(4)
      expect(report.flow.edges.some((e: { kind: string }) => e.kind === 'writes')).toBe(true)
      expect(report.notes.length).toBeGreaterThan(0)
    })

    it('never includes a credential value', async () => {
      await createAuditAction(program)(WORKSPACE, { output: 'json' })

      expect(getOutput(consoleSpy)).not.toContain(FIXTURE_SECRET)
    })

    it('reports an error as JSON rather than a stack trace', async () => {
      await expect(createAuditAction(program)('does-not-exist', { output: 'json' })).rejects.toThrow(
        'process.exit called'
      )

      expect(JSON.parse(getOutput(consoleSpy))).toMatchObject({ success: false })
      expect(exitSpy).toHaveBeenCalledWith(2)
    })
  })

  describe('edge cases', () => {
    it('tells the user to sync first when the directory holds no .deepnote files', async () => {
      const empty = await mkdtemp(join(tmpdir(), 'deepnote-audit-empty-'))
      try {
        await createAuditAction(program)(empty, DEFAULT_OPTIONS)

        const output = getOutput(consoleSpy)
        expect(output).toContain('No .deepnote files found')
        expect(output).toContain('deepnote sync')
        expect(exitSpy).not.toHaveBeenCalled()
      } finally {
        await rm(empty, { recursive: true, force: true })
      }
    })

    it('fails with invalid usage for a missing directory', async () => {
      await expect(createAuditAction(program)('no-such-directory', DEFAULT_OPTIONS)).rejects.toThrow(
        'process.exit called'
      )

      expect(exitSpy).toHaveBeenCalledWith(2)
    })

    it('audits a single .deepnote file', async () => {
      await createAuditAction(program)(
        resolve(process.cwd(), WORKSPACE, 'finance', 'revenue.deepnote'),
        DEFAULT_OPTIONS
      )

      expect(getOutput(consoleSpy)).toContain('1 project, 1 notebook')
    })
  })

  describe('audit command — the redaction boundary reaches the text output too', () => {
    const DSN = 'postgres://svc:hunter2correct@warehouse.internal:5432/analytics'

    /** Two projects sharing one hardcoded credential, so every report section is populated. */
    async function leakyWorkspace(): Promise<string> {
      const root = await mkdtemp(join(tmpdir(), 'deepnote-audit-redaction-'))
      const projects = [
        { dir: 'alpha', id: '44444444-4444-4444-8444-444444444444', name: `Export ${DSN}` },
        { dir: 'beta', id: '55555555-5555-4555-8555-555555555555', name: 'Second' },
      ]
      for (const [index, { dir, id, name }] of projects.entries()) {
        await mkdir(join(root, dir), { recursive: true })
        await writeFile(
          join(root, dir, 'project.deepnote'),
          [
            'metadata:',
            "  createdAt: '2025-06-02T09:14:00.000Z'",
            "  modifiedAt: '2026-02-11T16:40:00.000Z'",
            'project:',
            `  id: ${id}`,
            `  name: ${JSON.stringify(name)}`,
            '  notebooks:',
            `    - id: 1a2b3c4d5e6f4a5b8c9d0e1f2a3b4c5${index}`,
            `      name: ${JSON.stringify(`Notes ${DSN}`)}`,
            '      blocks:',
            `        - blockGroup: c1a2b3c4d5e6f708192a3b4c5d6e7f8${index}`,
            `          id: 9f1a2b3c4d5e6f708192a3b4c5d6e7f${index}`,
            '          type: code',
            '          sortingKey: a0',
            `          content: ${JSON.stringify(`DSN = "${DSN}"`)}`,
            "version: '1'",
          ].join('\n')
        )
      }
      return root
    }

    it('prints no credential in the default text report', async () => {
      setOutputConfig({ color: false })
      const root = await leakyWorkspace()
      try {
        await createAuditAction(program)(root, { issues: true })

        // The shared-credentials section prints project names directly, so the text renderer is a
        // second output path that could have been forgotten. It cannot be: the report is already
        // redacted by the time either renderer sees it.
        expect(getOutput(consoleSpy)).not.toContain('hunter2correct')
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })

    it('prints no credential in the JSON report', async () => {
      const root = await leakyWorkspace()
      try {
        await createAuditAction(program)(root, { output: 'json' })

        expect(getOutput(consoleSpy)).not.toContain('hunter2correct')
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })
  })

  describe('audit command — the error paths are redacted too', () => {
    const DSN = 'postgres://svc:hunter2correct@warehouse.internal:5432/analytics'

    async function namedWorkspace(): Promise<string> {
      const root = await mkdtemp(join(tmpdir(), 'deepnote-audit-notfound-'))
      await mkdir(join(root, 'alpha'), { recursive: true })
      await writeFile(
        join(root, 'alpha', 'project.deepnote'),
        [
          'metadata:',
          "  createdAt: '2025-06-02T09:14:00.000Z'",
          "  modifiedAt: '2026-02-11T16:40:00.000Z'",
          'project:',
          '  id: 44444444-4444-4444-8444-444444444444',
          `  name: ${JSON.stringify(`Export ${DSN}`)}`,
          '  notebooks:',
          '    - id: 1a2b3c4d5e6f4a5b8c9d0e1f2a3b4c5d',
          '      name: N',
          '      blocks:',
          '        - blockGroup: c1a2b3c4d5e6f708192a3b4c5d6e7f80',
          '          id: 9f1a2b3c4d5e6f708192a3b4c5d6e7f8',
          '          type: code',
          '          sortingKey: a0',
          '          content: x = 1',
          "version: '1'",
        ].join('\n')
      )
      return root
    }

    it.each([
      ['stderr', {} as AuditOptions, () => consoleErrorSpy.mock.calls.flat().join('\n')],
      ['stdout under -o json', { output: 'json' } as AuditOptions, () => getOutput(consoleSpy)],
    ])('masks a credential in the "project not found" message on %s', async (_name, options, read) => {
      setOutputConfig({ color: false })
      const root = await namedWorkspace()
      try {
        await expect(createAuditAction(program)(root, { ...options, project: 'Export postgres' })).rejects.toThrow(
          'process.exit called'
        )

        // This path never reaches `auditWorkspace`, so it inherits nothing from the report's
        // redaction boundary — and it names the closest project, which can be a connection string.
        const written = read()
        expect(written).not.toContain('hunter2correct')
        // Still useful: the name is masked, not withheld.
        expect(written).toContain('Closest match')
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })
  })
})

describe('describeNearest', () => {
  const names = ['Revenue reporting', 'Marketing campaigns', 'Churn analysis', 'Finance', 'Archive']

  it('offers a name the query is a prefix of', () => {
    expect(describeNearest('Revenue', names)).toContain('"Revenue reporting"')
  })

  it('matches case-insensitively', () => {
    expect(describeNearest('finance', names)).toContain('"Finance"')
  })

  it('offers nothing when the query resembles nothing, but still says how many there are', () => {
    const message = describeNearest('zzz', names)

    expect(message).not.toContain('"Revenue reporting"')
    expect(message).toContain('5 projects in this workspace')
  })

  it('caps the suggestions rather than listing the workspace', () => {
    const many = Array.from({ length: 200 }, (_, index) => `Report ${index}`)
    const message = describeNearest('Report', many)

    expect(message.match(/"/g)).toHaveLength(10)
    expect(message).toContain('200 projects in this workspace')
  })
})
