import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { resetOutputConfig } from '../output'
import { createInstallSkillsAction } from './install-skills'

function getOutput(spy: Mock<typeof console.log>): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n')
}

describe('install-skills command', () => {
  let program: Command
  let consoleSpy: Mock<typeof console.log>
  let consoleErrorSpy: Mock<typeof console.error>
  let tempDir: string

  beforeEach(async () => {
    program = new Command()
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    resetOutputConfig()
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepnote-skills-test-'))
  })

  afterEach(async () => {
    consoleSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('createInstallSkillsAction', () => {
    it('returns a function', () => {
      const action = createInstallSkillsAction(program)
      expect(typeof action).toBe('function')
    })
  })

  describe('install to project directory', () => {
    it('installs skill files for Claude Code by default when no agents detected', async () => {
      const action = createInstallSkillsAction(program)
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir)

      await action({})

      // Verify SKILL.md was created
      const skillPath = path.join(tempDir, '.claude', 'skills', 'deepnote', 'SKILL.md')
      const content = await fs.readFile(skillPath, 'utf8')
      expect(content).toContain('name: deepnote')

      // Verify reference directory was created with files
      const refsDir = path.join(tempDir, '.claude', 'skills', 'deepnote', 'references')
      const refs = await fs.readdir(refsDir)
      expect(refs.length).toBeGreaterThan(0)

      const output = getOutput(consoleSpy)
      expect(output).toContain('Claude Code')

      cwdSpy.mockRestore()
    })

    it('installs for detected agents', async () => {
      // Create .cursor config dir to simulate Cursor being installed
      await fs.mkdir(path.join(tempDir, '.cursor'), { recursive: true })

      const action = createInstallSkillsAction(program)
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir)

      await action({})

      const skillPath = path.join(tempDir, '.cursor', 'skills', 'deepnote', 'SKILL.md')
      const content = await fs.readFile(skillPath, 'utf8')
      expect(content).toContain('name: deepnote')

      const output = getOutput(consoleSpy)
      expect(output).toContain('Cursor')

      cwdSpy.mockRestore()
    })

    it('installs for specific agent with --agent', async () => {
      const action = createInstallSkillsAction(program)
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir)

      await action({ agent: 'cursor' })

      const skillPath = path.join(tempDir, '.cursor', 'skills', 'deepnote', 'SKILL.md')
      const content = await fs.readFile(skillPath, 'utf8')
      expect(content).toContain('name: deepnote')

      cwdSpy.mockRestore()
    })

    it('reports "already up to date" on second install', async () => {
      const action = createInstallSkillsAction(program)
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir)

      // First install
      await action({ agent: 'Claude Code' })
      consoleSpy.mockClear()

      // Second install
      await action({ agent: 'Claude Code' })

      const output = getOutput(consoleSpy)
      expect(output).toContain('already up to date')

      cwdSpy.mockRestore()
    })

    it('reports "updated" when content changes', async () => {
      const action = createInstallSkillsAction(program)
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir)

      // First install
      await action({ agent: 'Claude Code' })

      // Modify a file
      const skillPath = path.join(tempDir, '.claude', 'skills', 'deepnote', 'SKILL.md')
      await fs.writeFile(skillPath, 'old content', 'utf8')

      consoleSpy.mockClear()

      // Second install should detect change
      await action({ agent: 'Claude Code' })

      const output = getOutput(consoleSpy)
      expect(output).toContain('updated')

      cwdSpy.mockRestore()
    })
  })

  describe('install to global directory', () => {
    it('installs to home directory with --global', async () => {
      const action = createInstallSkillsAction(program)
      const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue(tempDir)

      await action({ global: true, agent: 'Claude Code' })

      const skillPath = path.join(tempDir, '.claude', 'skills', 'deepnote', 'SKILL.md')
      const content = await fs.readFile(skillPath, 'utf8')
      expect(content).toContain('name: deepnote')

      homeSpy.mockRestore()
    })
  })

  describe('dry run', () => {
    it('does not write files with --dry-run', async () => {
      const action = createInstallSkillsAction(program)
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir)

      await action({ dryRun: true, agent: 'Claude Code' })

      const skillDir = path.join(tempDir, '.claude', 'skills', 'deepnote')
      await expect(fs.access(skillDir)).rejects.toThrow()

      const output = getOutput(consoleSpy)
      expect(output).toContain('Dry run')

      cwdSpy.mockRestore()
    })
  })

  describe('error handling', () => {
    it('exits with error for unknown agent', async () => {
      const action = createInstallSkillsAction(program)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called')
      })

      await expect(action({ agent: 'unknown-agent' })).rejects.toThrow('process.exit called')

      exitSpy.mockRestore()
    })
  })

  describe('multiple agents', () => {
    it('installs for all detected agents', async () => {
      // Create multiple agent config dirs
      await fs.mkdir(path.join(tempDir, '.claude'), { recursive: true })
      await fs.mkdir(path.join(tempDir, '.cursor'), { recursive: true })

      const action = createInstallSkillsAction(program)
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir)

      await action({})

      // Both should have skill files
      for (const dir of ['.claude', '.cursor']) {
        const skillPath = path.join(tempDir, dir, 'skills', 'deepnote', 'SKILL.md')
        const content = await fs.readFile(skillPath, 'utf8')
        expect(content).toContain('name: deepnote')
      }

      const output = getOutput(consoleSpy)
      expect(output).toContain('Claude Code')
      expect(output).toContain('Cursor')

      cwdSpy.mockRestore()
    })
  })

  describe('skill file content', () => {
    it('installs all expected skill files', async () => {
      const action = createInstallSkillsAction(program)
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir)

      await action({ agent: 'Claude Code' })

      const baseDir = path.join(tempDir, '.claude', 'skills', 'deepnote')

      // Check SKILL.md
      const skillContent = await fs.readFile(path.join(baseDir, 'SKILL.md'), 'utf8')
      expect(skillContent).toContain('name: deepnote')
      expect(skillContent).toContain('Block Types')

      // Check block type reference files
      const blocksCodeSql = await fs.readFile(path.join(baseDir, 'references', 'blocks-code-and-sql.md'), 'utf8')
      expect(blocksCodeSql).toContain('Code Block')
      expect(blocksCodeSql).toContain('SQL Block')

      const blocksInput = await fs.readFile(path.join(baseDir, 'references', 'blocks-input.md'), 'utf8')
      expect(blocksInput).toContain('input-slider')

      // Check CLI reference files
      const cliRun = await fs.readFile(path.join(baseDir, 'references', 'cli-run.md'), 'utf8')
      expect(cliRun).toContain('deepnote run')

      const cliConvert = await fs.readFile(path.join(baseDir, 'references', 'cli-convert.md'), 'utf8')
      expect(cliConvert).toContain('deepnote convert')

      // Check auto-generated schema
      const schema = await fs.readFile(path.join(baseDir, 'references', 'schema.ts'), 'utf8')
      expect(schema).toContain('DeepnoteFile')

      cwdSpy.mockRestore()
    })
  })
})
