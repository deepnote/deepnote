import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveSkillDir } from './skill-files'

describe('resolveSkillDir', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-files-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function writeSkillMarker(...segments: string[]) {
    const dir = path.join(tempDir, ...segments)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'SKILL.md'), 'name: deepnote')
  }

  it('resolves from dirname when skills/deepnote/ exists there (npm install)', () => {
    writeSkillMarker('dist', 'skills', 'deepnote')

    const dirname = path.join(tempDir, 'dist')
    const result = resolveSkillDir(dirname, '/usr/local/bin/node')

    expect(result).toBe(path.join(dirname, 'skills', 'deepnote'))
  })

  it('resolves relative to execPath when dirname path is stale (pypi compiled binary)', () => {
    writeSkillMarker('site-packages', 'deepnote_cli', 'skills', 'deepnote')

    const staleDirname = path.join(tempDir, 'nonexistent', 'build', 'dist')
    const execPath = path.join(tempDir, 'site-packages', 'deepnote_cli', 'bin', 'deepnote')

    const result = resolveSkillDir(staleDirname, execPath)

    expect(result).toBe(path.join(tempDir, 'site-packages', 'deepnote_cli', 'skills', 'deepnote'))
  })

  it('walks up from dirname to find skills at repo root (dev mode)', () => {
    writeSkillMarker('repo', 'skills', 'deepnote')

    const dirname = path.join(tempDir, 'repo', 'packages', 'cli', 'src', 'skill')
    fs.mkdirSync(dirname, { recursive: true })

    const result = resolveSkillDir(dirname, '/usr/local/bin/node')

    expect(result).toBe(path.join(tempDir, 'repo', 'skills', 'deepnote'))
  })

  it('prefers dirname bundled path over execPath', () => {
    writeSkillMarker('dist', 'skills', 'deepnote')
    writeSkillMarker('pkg', 'skills', 'deepnote')

    const dirname = path.join(tempDir, 'dist')
    const execPath = path.join(tempDir, 'pkg', 'bin', 'deepnote')

    const result = resolveSkillDir(dirname, execPath)

    expect(result).toBe(path.join(dirname, 'skills', 'deepnote'))
  })

  it('prefers execPath over walk-up', () => {
    writeSkillMarker('repo', 'skills', 'deepnote')
    writeSkillMarker('repo', 'site-packages', 'deepnote_cli', 'skills', 'deepnote')

    const dirname = path.join(tempDir, 'repo', 'packages', 'cli', 'src', 'skill')
    fs.mkdirSync(dirname, { recursive: true })
    const execPath = path.join(tempDir, 'repo', 'site-packages', 'deepnote_cli', 'bin', 'deepnote')

    const result = resolveSkillDir(dirname, execPath)

    expect(result).toBe(path.join(tempDir, 'repo', 'site-packages', 'deepnote_cli', 'skills', 'deepnote'))
  })

  it('falls back to dirname bundled path when nothing is found', () => {
    const dirname = path.join(tempDir, 'nowhere')
    const result = resolveSkillDir(dirname, '/usr/local/bin/node')

    expect(result).toBe(path.join(dirname, 'skills', 'deepnote'))
  })
})
