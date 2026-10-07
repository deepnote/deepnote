import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { resetOutputConfig, setOutputConfig } from '../output'
import { type AuditOptions, createAuditAction } from './audit'

/** A three-project synced workspace with one of every workspace-scoped finding. */
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
      expect(output).toContain('3 projects, 3 notebooks')
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
      expect(output).toContain('This workspace has 3 projects')
    })

    it('summarises findings by check, and lists them with --issues', async () => {
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

    it('fails with invalid usage and lists the projects when the name is unknown', async () => {
      await expect(createAuditAction(program)(WORKSPACE, { project: 'Nope' })).rejects.toThrow('process.exit called')

      const stderr = consoleErrorSpy.mock.calls.flat().join('\n')
      expect(stderr).toContain('Project "Nope" not found')
      expect(stderr).toContain('"Marketing campaigns"')
      expect(exitSpy).toHaveBeenCalledWith(2)
    })
  })

  describe('-o json output', () => {
    it('emits the full report, including the flow map', async () => {
      await createAuditAction(program)(WORKSPACE, { output: 'json' })

      const report = JSON.parse(getOutput(consoleSpy))
      expect(report.scope).toBe('workspace')
      expect(report.summary.projects).toBe(3)
      expect(report.integrations).toHaveLength(3)
      expect(report.credentials).toHaveLength(1)
      expect(report.flow.nodes.filter((n: { kind: string }) => n.kind === 'project')).toHaveLength(3)
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
})
