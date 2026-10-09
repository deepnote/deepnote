import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { resetOutputConfig, setOutputConfig } from '../output'
import { MIN_REVIEWED_FOR_PRECISION } from '../utils/governance/review'
import type { DivergenceKind } from '../utils/governance/sql-divergence'
import { TRIAGE_ENV, type TriageProvider, type Verdict } from '../utils/governance/triage'
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
      expect(output).toContain('consensus thins out below roughly')
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

  describe('staleness and ranking', () => {
    it('reports how much of the workspace is still maintained', async () => {
      await createAuditAction(program)(WORKSPACE, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('Maintenance')
      expect(output).toContain('cold (3y+)')
      expect(output).toContain('median age')
    })

    it('inventories tables by live reach', async () => {
      await createAuditAction(program)(WORKSPACE, DEFAULT_OPTIONS)

      const output = getOutput(consoleSpy)
      expect(output).toContain('Tables — ranked by live reach')
      expect(output).toContain('users')
    })

    it('shows a score per check, and the ranked list with --issues', async () => {
      await createAuditAction(program)(WORKSPACE, DEFAULT_OPTIONS)
      const grouped = getOutput(consoleSpy)
      consoleSpy.mockClear()
      await createAuditAction(program)(WORKSPACE, { issues: true })
      const ranked = getOutput(consoleSpy)

      expect(grouped).toMatch(/\d+ ✖ credential-shared/)
      expect(ranked).toContain('Findings — ranked')
      expect(ranked).toContain('signal × exposure × neglect × blast radius')
    })

    it('ranks the findings highest score first', async () => {
      await createAuditAction(program)(WORKSPACE, { output: 'json' })

      const report = JSON.parse(getOutput(consoleSpy))
      const scores = report.issues.map((issue: { score: { score: number } }) => issue.score.score)
      expect(scores).toEqual([...scores].sort((a: number, b: number) => b - a))
      expect(report.issues[0].score).toMatchObject({
        signal: expect.any(Number),
        exposure: expect.any(Number),
        neglect: expect.any(Number),
        blastRadius: expect.any(Number),
      })
    })

    it('reports the stale notebook in the archive project', async () => {
      await createAuditAction(program)(WORKSPACE, { output: 'json' })

      const report = JSON.parse(getOutput(consoleSpy))
      const stale = report.issues.filter((issue: { code: string }) => issue.code === 'asset-stale')
      expect(stale).toHaveLength(1)
      expect(stale[0].projectName).toBe('Churn 2021')
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

  describe('audit command — personal data in a name is masked everywhere it appears', () => {
    // A project and a notebook named after the people the work is for. Both are ordinary workspace
    // hygiene, and both put an address into fields nobody classifies as sensitive.
    const CUSTOMER = 'alice.smith@customer-corp.example'
    const PARTNER = 'bob.jones@partner.example'

    async function namedWorkspace(): Promise<string> {
      const root = await mkdtemp(join(tmpdir(), 'deepnote-audit-subjects-'))
      await mkdir(join(root, 'reports'), { recursive: true })
      await writeFile(
        join(root, 'reports', 'project.deepnote'),
        [
          'metadata:',
          "  createdAt: '2025-06-02T09:14:00.000Z'",
          "  modifiedAt: '2026-02-11T16:40:00.000Z'",
          'project:',
          '  id: 66666666-6666-4666-8666-666666666666',
          `  name: ${JSON.stringify(`Report for ${CUSTOMER}`)}`,
          '  notebooks:',
          '    - id: 1a2b3c4d5e6f4a5b8c9d0e1f2a3b4c5d',
          `      name: ${JSON.stringify(`Notes ${PARTNER}`)}`,
          '      blocks:',
          '        - blockGroup: c1a2b3c4d5e6f708192a3b4c5d6e7f80',
          '          id: 9f1a2b3c4d5e6f708192a3b4c5d6e7f8',
          '          type: code',
          '          sortingKey: a0',
          '          content: TOKEN = "AKIAIOSFODNN7EXAMPLE"',
          '        - blockGroup: c2a2b3c4d5e6f708192a3b4c5d6e7f80',
          '          id: 8f1a2b3c4d5e6f708192a3b4c5d6e7f8',
          '          type: code',
          '          sortingKey: a1',
          '          content: requests.post("https://hooks.example.com/ingest", data=df)',
          '        - blockGroup: c3a2b3c4d5e6f708192a3b4c5d6e7f80',
          '          id: 7f1a2b3c4d5e6f708192a3b4c5d6e7f8',
          '          type: sql',
          '          sortingKey: a2',
          `          content: ${JSON.stringify(`SELECT id FROM users WHERE owner = '${CUSTOMER}'`)}`,
          "version: '1'",
        ].join('\n')
      )
      return root
    }

    it.each([
      ['the JSON report', { output: 'json' } as AuditOptions],
      ['the default text report', { issues: true } as AuditOptions],
    ])('names nobody in %s, at any depth', async (_name, options) => {
      setOutputConfig({ color: false })
      const root = await namedWorkspace()
      try {
        await createAuditAction(program)(root, options)

        // Every field at every depth, not a hand-picked list. The project name reaches
        // `credentials[].projects[]`, `egress[].projects[]`, `integrations[].consumers[]` and the
        // flow-map labels; the notebook name reaches `issues[].notebookName` and `path`.
        const serialized = getOutput(consoleSpy)
        expect(serialized).not.toContain(CUSTOMER)
        expect(serialized).not.toContain(PARTNER)
        expect(serialized).not.toContain('alice.smith')
        expect(serialized).not.toContain('bob.jones')
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    })

    it('still names the project and notebook, with only the address removed', async () => {
      const root = await namedWorkspace()
      try {
        await createAuditAction(program)(root, { output: 'json' })
        const report = JSON.parse(getOutput(consoleSpy)) as { issues: Array<{ notebookName: string }> }

        expect(report.issues[0].notebookName).toContain('Notes')
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

describe('audit command — two notebooks in one project sharing a name', () => {
  let program: Command
  let consoleSpy: Mock<typeof console.log>
  let root: string

  /** One project id across two files, each holding a notebook called "Daily" with a bad predicate. */
  const notebook = (file: string) => `metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
  modifiedAt: '2026-09-01T00:00:00.000Z'
project:
  id: 11111111-1111-4111-8111-111111111111
  name: Reporting
  notebooks:
    - id: ${file}aaaabbbbccccddddeeeeffff0000
      name: Daily
      blocks:
        - blockGroup: ${file}1111222233334444555566667777
          id: ${file}8888999900001111222233334444
          type: sql
          sortingKey: a0
          metadata: {}
          content: SELECT * FROM orders WHERE cancelled_at = NULL
version: '1'
`

  beforeEach(async () => {
    program = new Command()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    resetOutputConfig()
    setOutputConfig({ color: false })
    root = await mkdtemp(join(tmpdir(), 'deepnote-dup-notebook-'))
    await mkdir(join(root, 'alpha'))
    await mkdir(join(root, 'beta'))
    await writeFile(join(root, 'alpha', 'daily.deepnote'), notebook('a'))
    await writeFile(join(root, 'beta', 'daily.deepnote'), notebook('b'))
  })

  afterEach(async () => {
    consoleSpy.mockRestore()
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  it('shows the path, because the project and notebook alone name both of them', async () => {
    await createAuditAction(program)(root, { issues: true })
    const output = getOutput(consoleSpy)

    const located = output.split('\n').filter(line => line.includes('Reporting · Daily'))
    expect(located).toHaveLength(2)
    // Without the path these two rows are the same string, and a reader cannot act on either.
    expect(located[0]).not.toBe(located[1])
    expect(output).toContain('Daily (alpha/daily.deepnote)')
    expect(output).toContain('Daily (beta/daily.deepnote)')
  })

  it('leaves the path out when the readable location is already unique', async () => {
    await rm(join(root, 'beta'), { recursive: true })
    await createAuditAction(program)(root, { issues: true })

    expect(getOutput(consoleSpy)).toContain('Reporting · Daily ')
    expect(getOutput(consoleSpy)).not.toContain('Daily (alpha/daily.deepnote)')
  })
})

/** A six-project workspace built so that each anchor family has a consensus and a dissenter. */
const DIVERGENCE_WORKSPACE = join('test-fixtures', 'workspace-divergence')

describe('audit command — divergence', () => {
  let program: Command
  let consoleSpy: Mock<typeof console.log>
  let exitSpy: Mock<typeof process.exit>

  let consoleErrorSpy: Mock<typeof console.error>

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
    vi.restoreAllMocks()
  })

  /**
   * Run triage against a port nothing is listening on.
   *
   * This is the only way to reach the configured-endpoint path without a model: an injected
   * provider short-circuits it, which is exactly why the status lines went unnoticed. The
   * connection is refused on loopback, so nothing leaves the machine and the result is
   * deterministic — and it exercises fail-soft at the same time.
   */
  async function withDeadEndpoint(options: Record<string, unknown>): Promise<void> {
    const original = { ...process.env }
    process.env[TRIAGE_ENV.baseUrl] = 'http://127.0.0.1:1'
    process.env[TRIAGE_ENV.model] = 'test-model'
    try {
      await createAuditAction(program)(DIVERGENCE_WORKSPACE, { divergence: true, triageCache: false, ...options })
    } finally {
      for (const key of Object.values(TRIAGE_ENV)) {
        delete process.env[key]
      }
      Object.assign(process.env, original)
    }
  }

  it('keeps -o json parseable while still disclosing the endpoint', async () => {
    // Same defect as the review export: status lines in front of the document, exit code still 0,
    // so a caller reads a successful run and unparseable output. They move to stderr rather than
    // being dropped — saying where the SQL is going, before it goes, is a guarantee this command
    // makes, and the automated path is the one where nobody is watching.
    await withDeadEndpoint({ triage: true, output: 'json' })

    const stdout = getOutput(consoleSpy)
    expect(() => JSON.parse(stdout)).not.toThrow()
    expect(stdout).not.toContain('Triage:')

    const stderr = getOutput(consoleErrorSpy as unknown as Mock<typeof console.log>)
    expect(stderr).toContain('http://127.0.0.1:1')
    expect(stderr).toContain('no blocks, no outputs')
  })

  it('still prints the endpoint to stdout for a person', async () => {
    await withDeadEndpoint({ triage: true })

    expect(getOutput(consoleSpy)).toContain('http://127.0.0.1:1')
  })

  it('does not fail the audit when the model cannot be reached', async () => {
    await withDeadEndpoint({ triage: true, output: 'json' })

    const report = JSON.parse(getOutput(consoleSpy))
    expect(exitSpy).not.toHaveBeenCalled()
    // Every finding keeps the deterministic score it would have had without triage.
    for (const issue of report.issues.filter((i: { code: string }) => i.code === 'sql-divergence')) {
      expect(issue.details.signalSource).toBe('prior')
    }
  })

  it('collapses divergence to a count by default', async () => {
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, DEFAULT_OPTIONS)
    const text = getOutput(consoleSpy)

    expect(text).toContain('Consensus — divergence')
    expect(text).toContain('2 anchors defined more than one way')
    expect(text).toContain('--divergence to see every variant')
    // Collapsed means collapsed: no variant detail without the flag.
    expect(text).not.toContain('orders.user_id = users.id')
  })

  it('prints every variant and where it is used under --divergence', async () => {
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { divergence: true })
    const text = getOutput(consoleSpy)

    expect(text).toContain('orders ↔ users')
    expect(text).toContain('consensus  orders.user_id = users.id')
    expect(text).toContain('diverges   orders.email = users.email')
    expect(text).toContain('Legacy reporting · Quarterly board pack')
    expect(text).toContain('Wilson lower bound')
  })

  it('names the block, so two dissenters in one notebook are told apart', async () => {
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, {
      divergence: true,
      divergenceKind: ['join', 'filter', 'metric'],
    })
    const text = getOutput(consoleSpy)

    expect(text).toContain('SELECT sum(o.amount_gross) AS revenue')
    expect(text).toContain("SELECT * FROM orders o WHERE o.status = 'paid'")
  })

  it('reports the join and metric families by default, and filter only on request', async () => {
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { divergence: true })
    const byDefault = getOutput(consoleSpy)

    expect(byDefault).toContain('join  ')
    expect(byDefault).toContain('metric')
    // Lowest precision of the three, and the bulk of the output. What it reliably catches that is
    // actually wrong — a comparison against NULL — `sql-null-comparison` already catches.
    expect(byDefault).not.toContain('filter')

    consoleSpy.mockClear()
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { divergence: true, divergenceKind: ['filter'] })

    expect(getOutput(consoleSpy)).toContain('filter')
  })

  it('restricts the anchor families on request', async () => {
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { divergence: true, divergenceKind: ['join'] })
    const text = getOutput(consoleSpy)

    expect(text).toContain('orders ↔ users')
    expect(text).not.toContain('no filter on orders.is_test')
  })

  it('raises no findings above an unreachable confidence floor, but still shows the groups', async () => {
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { divergence: true, minConfidence: 0.99, issues: true })
    const text = getOutput(consoleSpy)

    expect(text).toContain('orders ↔ users')
    expect(text).not.toContain('sql-divergence')
  })

  it('omits the section entirely with --skip-divergence', async () => {
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { skipDivergence: true })
    const text = getOutput(consoleSpy)

    expect(text).not.toContain('Consensus — divergence')
    expect(text).not.toContain('sql-divergence')
  })

  it('says so rather than printing an empty section when nothing diverges', async () => {
    await createAuditAction(program)(WORKSPACE, { divergence: true })
    const text = getOutput(consoleSpy)

    expect(text).toContain('No anchor is defined two ways, or the corpus is too small to tell')
  })

  it('carries every group, variant and location in the JSON', async () => {
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { output: 'json' })
    const report = JSON.parse(getOutput(consoleSpy))

    expect(report.divergence).toHaveLength(2)
    const join = report.divergence.find((group: { kind: string }) => group.kind === 'join')
    expect(join).toMatchObject({ anchorLabel: 'orders ↔ users', observations: 5, projectCount: 5 })
    expect(join.confidence).toBeGreaterThan(0.25)
    expect(join.variants).toHaveLength(2)
    expect(join.variants[1].members[0].location.projectName).toBe('Legacy reporting')
  })

  it('ranks a divergence in an abandoned notebook above the same one in a live notebook', async () => {
    // Filter anchors, which this fixture puts in both a cold and a live notebook, are opt-in.
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { output: 'json', divergenceKind: ['filter'] })
    const report = JSON.parse(getOutput(consoleSpy))

    const missingFilter = report.issues.filter(
      (issue: { code: string; details?: { kind?: string } }) =>
        issue.code === 'sql-divergence' && issue.details?.kind === 'filter'
    )
    const legacy = missingFilter.find((issue: { projectName: string }) => issue.projectName === 'Legacy reporting')
    const sales = missingFilter.find((issue: { projectName: string }) => issue.projectName === 'Sales pipeline')

    expect(legacy.score.score).toBeGreaterThan(sales.score.score)
    expect(legacy.score.neglect).toBeGreaterThan(sales.score.neglect)
  })

  it('still exits 0: divergence is a ranking, not a gate', async () => {
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { divergence: true })

    expect(exitSpy).not.toHaveBeenCalled()
  })
})

describe('audit command — triage', () => {
  let program: Command
  let consoleSpy: Mock<typeof console.log>
  let exitSpy: Mock<typeof process.exit>

  beforeEach(() => {
    program = new Command()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    resetOutputConfig()
    setOutputConfig({ color: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** A provider that answers every candidate the same way. */
  function provider(verdict: Verdict, reason = 'because'): TriageProvider {
    return {
      async triage(batch) {
        return batch.map(candidate => ({ id: candidate.id, verdict, reason }))
      },
    }
  }

  interface ReportIssue {
    code: string
    projectName: string
    score: { signal: number; score: number }
    details: Record<string, unknown>
  }
  interface Report {
    issues: ReportIssue[]
    suppressed: ReportIssue[]
  }

  /**
   * `--triage` judges metric anchors only unless `--divergence-kind` is given, so tests about what
   * a verdict *does* name the kinds explicitly. The default itself is tested on its own below.
   */
  const ALL_KINDS: DivergenceKind[] = ['join', 'metric']

  async function reportWith(options: AuditOptions): Promise<Report> {
    consoleSpy.mockClear()
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { output: 'json', ...options })
    return JSON.parse(getOutput(consoleSpy)) as Report
  }

  /** Identify a finding across two runs, since the ranking itself is what changes. */
  const keyOf = (issue: ReportIssue) => `${issue.details.anchor}:${issue.projectName}:${issue.details.variant}`

  it('is off by default, and the report is byte-identical to one that never heard of triage', async () => {
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { output: 'json' })
    const before = getOutput(consoleSpy)
    consoleSpy.mockClear()

    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { output: 'json', triage: false })
    expect(getOutput(consoleSpy)).toBe(before)

    const report = JSON.parse(before)
    expect(report.suppressed).toEqual([])
    for (const issue of report.issues.filter((i: { code: string }) => i.code === 'sql-divergence')) {
      expect(issue.details.signalSource).toBe('prior')
      expect(issue.details.verdict).toBeUndefined()
    }
  })

  it('fails with usage guidance when --triage has no configured endpoint', async () => {
    const original = { ...process.env }
    for (const key of Object.values(TRIAGE_ENV)) {
      delete process.env[key]
    }
    try {
      await expect(createAuditAction(program)(DIVERGENCE_WORKSPACE, { triage: true })).rejects.toThrow(
        'process.exit called'
      )
      expect(exitSpy).toHaveBeenCalledWith(2)
    } finally {
      Object.assign(process.env, original)
    }
  })

  it('lets a verdict replace the prior, and records both', async () => {
    const report = await reportWith({
      triage: true,
      divergenceKind: ALL_KINDS,
      triageProvider: provider('real', 'the join keys disagree'),
    })

    const divergence = report.issues.filter(i => i.code === 'sql-divergence')
    expect(divergence.length).toBeGreaterThan(0)
    for (const issue of divergence) {
      expect(issue.details.signalSource).toBe('triage')
      expect(issue.details.verdict).toBe('real')
      expect(issue.details.verdictReason).toBe('the join keys disagree')
      // The displaced number is kept, so a reviewer can always see what the other answer was.
      expect(typeof issue.details.prior).toBe('number')
      expect(issue.score.signal).not.toBe(issue.details.prior)
    }
  })

  it('judges metric anchors by default, and leaves joins on their deterministic score', async () => {
    // Metric anchors are the bulk of the output and the ones where the question is about intent.
    // Joins are few and structural, so a model call on them buys little.
    const report = await reportWith({ triage: true, triageProvider: provider('real') })

    const bySource = new Map(
      report.issues
        .filter(issue => issue.code === 'sql-divergence')
        .map(issue => [issue.details.kind as string, issue.details.signalSource as string])
    )

    expect(bySource.get('metric')).toBe('triage')
    expect(bySource.get('join')).toBe('prior')
  })

  it('judges every family the audit looked for when --divergence-kind is explicit', async () => {
    const report = await reportWith({ triage: true, divergenceKind: ALL_KINDS, triageProvider: provider('real') })

    const sources = report.issues
      .filter(issue => issue.code === 'sql-divergence')
      .map(issue => issue.details.signalSource)

    expect(sources.length).toBeGreaterThan(0)
    expect(new Set(sources)).toEqual(new Set(['triage']))
  })

  it('reports the resolved endpoint even when the workspace yields nothing to judge', async () => {
    // Lazy resolution meant a `--triage` run over a workspace with no groups exited 0 without
    // mentioning triage at all, so a CI job misconfigured for weeks read as a clean pass.
    await expect(createAuditAction(program)(WORKSPACE, { triage: true })).rejects.toThrow('process.exit called')

    expect(exitSpy).toHaveBeenCalledWith(2)
  })

  it('raises the signal of the same finding above what the prior gave it', async () => {
    const withPrior = await reportWith({ divergenceKind: ALL_KINDS })
    const withVerdict = await reportWith({
      triage: true,
      divergenceKind: ALL_KINDS,
      triageProvider: provider('real'),
    })

    // Compared per finding, not per rank: the ranking is exactly what a verdict is allowed to
    // change, so comparing "the top one" would compare two different findings.
    const priors = new Map(withPrior.issues.filter(i => i.code === 'sql-divergence').map(i => [keyOf(i), i]))
    const judged = withVerdict.issues.filter(i => i.code === 'sql-divergence')

    expect(judged.length).toBeGreaterThan(0)
    for (const issue of judged) {
      const before = priors.get(keyOf(issue))
      expect(before).toBeDefined()
      expect(issue.score.signal).toBeGreaterThan((before as ReportIssue).score.signal)
    }
  })

  it('takes a false positive out of the ranking but keeps it in the JSON', async () => {
    const report = await reportWith({
      triage: true,
      divergenceKind: ALL_KINDS,
      triageProvider: provider('false-positive', 'count(1) and count(*) are the same thing'),
    })

    expect(report.issues.filter(i => i.code === 'sql-divergence')).toEqual([])
    expect(report.suppressed.length).toBeGreaterThan(0)
    expect(report.suppressed[0].details.verdictReason).toBe('count(1) and count(*) are the same thing')
  })

  it('prints what it suppressed and why', async () => {
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, {
      triage: true,
      divergenceKind: ALL_KINDS,
      triageProvider: provider('false-positive', 'the two forms mean the same thing'),
    })
    const text = getOutput(consoleSpy)

    expect(text).toContain('Suppressed by triage')
    expect(text).toContain('the two forms mean the same thing')
  })

  it('keeps the deterministic score when the provider fails, and still exits 0', async () => {
    const failing: TriageProvider = {
      async triage() {
        throw new Error('connect ECONNREFUSED')
      },
    }
    const report = await reportWith({ triage: true, triageProvider: failing })

    for (const issue of report.issues.filter(i => i.code === 'sql-divergence')) {
      expect(issue.details.signalSource).toBe('prior')
    }
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('sends nothing when there is nothing to triage', async () => {
    let called = false
    const watcher: TriageProvider = {
      async triage(batch) {
        called = true
        return batch.map(c => ({ id: c.id, verdict: 'real' as const, reason: '' }))
      },
    }
    await createAuditAction(program)(WORKSPACE, { triage: true, triageProvider: watcher })

    expect(called).toBe(false)
  })
})

describe('audit command — divergence scoping end to end', () => {
  let program: Command
  let consoleSpy: Mock<typeof console.log>

  beforeEach(() => {
    program = new Command()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    resetOutputConfig()
    setOutputConfig({ color: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function divergence(options: AuditOptions = {}) {
    consoleSpy.mockClear()
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { output: 'json', ...options })
    return JSON.parse(getOutput(consoleSpy)).divergence as Array<{
      kind: string
      observations: number
      scopeRule: string
      scopeKey: string
    }>
  }

  it('does not fold a second warehouse into the first', async () => {
    // The fixture's Research project runs byte-identical SQL against its own Postgres
    // integration. Under the old unscoped behaviour those queries joined every group.
    const scoped = await divergence()
    const pooled = await divergence({ divergenceScope: 'none' })

    for (const group of scoped) {
      const same = pooled.find(other => other.kind === group.kind)
      expect(same?.observations).toBeGreaterThan(group.observations)
    }
    expect(scoped.every(group => group.scopeRule === 'integration')).toBe(true)
  })

  it('raises no finding from identical SQL behind a different integration', async () => {
    const groups = await divergence()

    // Research's two queries are alone in their scope, so neither reaches the observation floor.
    expect(groups.every(group => group.scopeKey !== 'eeeeeeee-2222-4222-8222-eeeeeeeeeeee')).toBe(true)
  })

  it('records which rule admitted the queries, on every finding', async () => {
    consoleSpy.mockClear()
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { output: 'json' })
    const report = JSON.parse(getOutput(consoleSpy))

    for (const issue of report.issues.filter((i: { code: string }) => i.code === 'sql-divergence')) {
      expect(issue.details.scopeRule).toBe('integration')
      expect(typeof issue.details.scopeKey).toBe('string')
    }
  })
})

describe('audit command — review round trip', () => {
  let program: Command
  let consoleSpy: Mock<typeof console.log>
  let exitSpy: Mock<typeof process.exit>
  let workDir: string

  beforeEach(async () => {
    program = new Command()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    resetOutputConfig()
    setOutputConfig({ color: false })
    workDir = await mkdtemp(join(tmpdir(), 'deepnote-review-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(workDir, { recursive: true, force: true })
  })

  it('exports every group with a blank verdict and somewhere to look', async () => {
    const path = join(workDir, 'review.json')
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { divergence: true, exportReview: path })

    const file = JSON.parse(await readFile(path, 'utf8'))
    expect(file.reviewed).toBe(0)
    expect(file.entries.length).toBeGreaterThan(0)
    expect(file.entries.every((e: { verdict: string }) => e.verdict === '')).toBe(true)
    expect(file.entries[0].variants[0].locations.length).toBeGreaterThan(0)
    expect(getOutput(consoleSpy)).toContain('Review export')
  })

  it('keeps -o json parseable while still writing the review file', async () => {
    // The export announcement is four lines of instructions. In front of a JSON document, with the
    // command still exiting 0, a pipeline reads a successful run and unparseable output.
    const path = join(workDir, 'review.json')
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { divergence: true, exportReview: path, output: 'json' })

    const stdout = getOutput(consoleSpy)
    expect(() => JSON.parse(stdout)).not.toThrow()
    expect(stdout).not.toContain('Review export')
    expect(JSON.parse(await readFile(path, 'utf8')).entries.length).toBeGreaterThan(0)
  })

  it('refuses a review file with a verdict nobody can act on', async () => {
    const path = join(workDir, 'bad.json')
    await writeFile(
      path,
      JSON.stringify({ version: 1, entries: [{ id: 'x', kind: 'join', subject: 's', verdict: 'maybe' }] })
    )

    await expect(createAuditAction(program)(DIVERGENCE_WORKSPACE, { importReview: path })).rejects.toThrow(
      'process.exit called'
    )
    expect(exitSpy).toHaveBeenCalledWith(2)
  })

  it('reports measured precision but keeps the default below the floor', async () => {
    const path = join(workDir, 'thin.json')
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { divergence: true, exportReview: path })
    const file = JSON.parse(await readFile(path, 'utf8'))
    for (const entry of file.entries) {
      entry.verdict = 'real'
    }
    await writeFile(path, JSON.stringify(file))
    consoleSpy.mockClear()

    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { importReview: path })
    const text = getOutput(consoleSpy)

    expect(text).toContain('Measured precision')
    // Three reviewed entries is an anecdote, not a precision.
    expect(text).toContain(`needs ${MIN_REVIEWED_FOR_PRECISION} to be used`)
  })

  it('uses the measurement once there is enough of it, and says so in the JSON', async () => {
    // A synthetic file with enough join verdicts to clear the floor, carrying the real ids so the
    // measurement attaches to the groups the workspace actually produced.
    const path = join(workDir, 'full.json')
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { divergence: true, exportReview: path })
    const file = JSON.parse(await readFile(path, 'utf8'))
    const padding = Array.from({ length: MIN_REVIEWED_FOR_PRECISION }, (_, i) => ({
      id: `pad-${i}`,
      kind: 'join',
      subject: `pad ${i}`,
      verdict: 'real',
      confidence: 0.5,
      observations: 4,
      projectCount: 4,
      scopeKey: 'x',
      variants: [],
    }))
    await writeFile(path, JSON.stringify({ ...file, entries: [...file.entries, ...padding] }))
    consoleSpy.mockClear()

    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { output: 'json', importReview: path })
    const report = JSON.parse(getOutput(consoleSpy))

    const joins = report.issues.filter(
      (i: { code: string; details: { kind: string } }) => i.code === 'sql-divergence' && i.details.kind === 'join'
    )
    expect(joins.length).toBeGreaterThan(0)
    for (const issue of joins) {
      expect(issue.details.signalSource).toBe('measured')
      expect(issue.details.measuredPrecision).toBe(1)
    }
  })
})

describe('audit command — dependencies and SBOM', () => {
  let program: Command
  let consoleSpy: Mock<typeof console.log>

  beforeEach(() => {
    program = new Command()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    resetOutputConfig()
    setOutputConfig({ color: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports how much of the workspace is reproducible', async () => {
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, DEFAULT_OPTIONS)
    const text = getOutput(consoleSpy)

    expect(text).toContain('Dependencies')
    expect(text).toMatch(/\d+ packages, \d+ pinned/)
    expect(text).toContain('pandas pinned to 1.5.3 and 2.0.1')
    expect(text).toContain('matplotlib unpinned')
  })

  it('lists only versions maintained projects hold, not the abandoned one', async () => {
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { packages: true })
    const text = getOutput(consoleSpy)

    // Legacy reporting pins pandas 1.3.5, but it has not been touched since 2021.
    expect(text).toContain('pandas pinned to 1.5.3 and 2.0.1')
    expect(text).not.toContain('1.3.5 and')
  })

  it('writes a CycloneDX document instead of the report under --sbom', async () => {
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { sbom: true })
    const document = JSON.parse(getOutput(consoleSpy))

    expect(document).toMatchObject({ bomFormat: 'CycloneDX', specVersion: '1.5', version: 1 })
    expect(document.metadata.component.name).toBe('workspace-divergence')
    expect(document.components.every((component: { type: string }) => component.type === 'library')).toBe(true)
  })

  it('emits one component per version, so each has a purl a scanner can match', async () => {
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { sbom: true })
    const document = JSON.parse(getOutput(consoleSpy))

    const purls = document.components.map((component: { purl: string }) => component.purl)
    expect(purls).toContain('pkg:pypi/pandas@1.3.5')
    expect(purls).toContain('pkg:pypi/pandas@2.0.1')
    // A package nobody pinned has no version to match on, and is emitted anyway — that is the
    // finding, not an omission.
    expect(purls).toContain('pkg:pypi/matplotlib')
  })

  it('attributes each version to the projects that pin it', async () => {
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { sbom: true })
    const document = JSON.parse(getOutput(consoleSpy))

    const old = document.components.find((component: { purl: string }) => component.purl === 'pkg:pypi/pandas@1.3.5')
    const projects = old.properties.find((p: { name: string }) => p.name === 'deepnote:projects')
    expect(projects.value).toBe('Legacy reporting')
  })

  it('carries the bill of materials in the JSON report too', async () => {
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { output: 'json' })
    const report = JSON.parse(getOutput(consoleSpy))

    const pandas = report.packages.find((entry: { name: string }) => entry.name === 'pandas')
    expect(pandas).toMatchObject({ drifted: true, maintainedVersions: ['1.5.3', '2.0.1'] })
    // Six consumers: five that declare a version, plus the project that installs it bare.
    expect(pandas.projects).toHaveLength(6)
  })

  it('finds a package installed by a block but not tracked by the environment', async () => {
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { output: 'json' })
    const report = JSON.parse(getOutput(consoleSpy))

    const untracked = report.issues.filter((issue: { code: string }) => issue.code === 'dependency-untracked')
    expect(untracked).toHaveLength(1)
    expect(untracked[0].details.package).toBe('xlsxwriter')
  })

  it('omits the section for a workspace that declares no dependencies', async () => {
    await createAuditAction(program)(WORKSPACE, DEFAULT_OPTIONS)

    expect(getOutput(consoleSpy)).not.toContain('Dependencies')
  })
})

describe('audit command — the SBOM represents what is not pinned', () => {
  let program: Command
  let consoleSpy: Mock<typeof console.log>

  beforeEach(() => {
    program = new Command()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    resetOutputConfig()
    setOutputConfig({ color: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function sbom() {
    consoleSpy.mockClear()
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { sbom: true })
    return JSON.parse(getOutput(consoleSpy)) as {
      components: Array<{
        name: string
        version?: string
        purl: string
        properties: Array<{ name: string; value: string }>
      }>
    }
  }

  it('keeps a versionless component for a package that is pinned somewhere and not elsewhere', async () => {
    // The fixture pins pandas in three projects and installs it bare in a fourth. Dropping the
    // versionless component would let the document claim a reproducibility the workspace does not
    // have, which is the one thing a bill of materials must not do.
    const purls = (await sbom()).components.map(c => c.purl)

    expect(purls).toContain('pkg:pypi/pandas@2.0.1')
    expect(purls).toContain('pkg:pypi/pandas')
  })

  it('attributes the versionless component to whoever did not pin it', async () => {
    const bare = (await sbom()).components.find(c => c.purl === 'pkg:pypi/pandas')
    const projects = bare?.properties.find(p => p.name === 'deepnote:projects')

    expect(projects?.value).toBe('Research experiments')
  })

  it('does not add a versionless component to a package everyone pins', async () => {
    const purls = (await sbom()).components.map(c => c.purl)

    expect(purls).toContain('pkg:pypi/numpy@1.26.0')
    expect(purls).not.toContain('pkg:pypi/numpy')
  })

  it('reports the version a project ends up with, not the lowest one seen', async () => {
    consoleSpy.mockClear()
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { output: 'json' })
    const report = JSON.parse(getOutput(consoleSpy))

    const pandas = report.packages.find((p: { name: string }) => p.name === 'pandas')
    const legacy = pandas.projects.find((p: { projectName: string }) => p.projectName === 'Legacy reporting')
    expect(legacy.version).toBe('1.3.5')
  })

  it('does not read a shell continuation as a requirement', async () => {
    consoleSpy.mockClear()
    await createAuditAction(program)(DIVERGENCE_WORKSPACE, { output: 'json' })
    const report = JSON.parse(getOutput(consoleSpy))

    // The Research project runs `!pip install pandas && python -m pytest`.
    const names = report.packages.map((p: { name: string }) => p.name)
    expect(names).toContain('pandas')
    expect(names).not.toContain('python')
    expect(names).not.toContain('pytest')
  })
})
