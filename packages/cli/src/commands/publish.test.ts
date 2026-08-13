import fs from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepnote/cloud', () => ({
  STATIC_ROOT: '_deepnote_static',
  staticPath: (rel: string) => `_deepnote_static/${rel.replace(/\\/g, '/').replace(/^\/+/, '')}`,
  uploadFile: vi.fn(),
}))

import { uploadFile } from '@deepnote/cloud'
import { createProgram } from '../cli'

const mockedUpload = vi.mocked(uploadFile)

let tempDir: string

beforeEach(async () => {
  tempDir = await fs.mkdtemp(join(os.tmpdir(), 'publish-test-'))
  mockedUpload.mockReset()
})

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function run(...args: string[]) {
  const program = createProgram()
  return program.parseAsync(['node', 'deepnote', 'publish', ...args])
}

describe('deepnote publish', () => {
  it('uploads all files in a directory to _deepnote_static/', async () => {
    await fs.writeFile(join(tempDir, 'index.html'), '<h1>hello</h1>')
    await fs.mkdir(join(tempDir, 'css'))
    await fs.writeFile(join(tempDir, 'css', 'style.css'), 'body {}')

    mockedUpload.mockResolvedValue({ projectId: 'p1', path: '' })

    await run(tempDir, '--project-id', 'p1', '--token', 'tok', '-q')

    expect(mockedUpload).toHaveBeenCalledTimes(2)

    const paths = mockedUpload.mock.calls.map(c => c[3]).sort()
    expect(paths).toEqual(['_deepnote_static/css/style.css', '_deepnote_static/index.html'])

    for (const call of mockedUpload.mock.calls) {
      expect(call[0]).toBe('https://api.deepnote.com')
      expect(call[1]).toBe('tok')
      expect(call[2]).toBe('p1')
    }
  })

  it('uses a custom --path prefix when provided', async () => {
    await fs.writeFile(join(tempDir, 'app.js'), 'console.log("hi")')
    mockedUpload.mockResolvedValue({ projectId: 'p1', path: '' })

    await run(tempDir, '--project-id', 'p1', '--token', 'tok', '--path', 'custom/prefix', '-q')

    expect(mockedUpload.mock.calls[0]?.[3]).toBe('custom/prefix/app.js')
  })

  it('exits with code 2 when directory does not exist', async () => {
    const spy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    await expect(run('/nonexistent/dir', '--project-id', 'p1', '--token', 'tok')).rejects.toThrow()
    spy.mockRestore()
  })

  it('exits with code 2 when directory is empty', async () => {
    const spy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    await expect(run(tempDir, '--project-id', 'p1', '--token', 'tok')).rejects.toThrow()
    spy.mockRestore()
  })

  it('reports upload failures without aborting other files', async () => {
    await fs.writeFile(join(tempDir, 'good.html'), 'ok')
    await fs.writeFile(join(tempDir, 'bad.html'), 'fail')

    mockedUpload.mockImplementation(async (_base, _tok, _pid, path) => {
      if (typeof path === 'string' && path.includes('bad.html')) {
        throw new Error('upload failed')
      }
      return { projectId: 'p1', path: path as string }
    })

    await run(tempDir, '--project-id', 'p1', '--token', 'tok', '-q')

    expect(mockedUpload).toHaveBeenCalledTimes(2)
    expect(process.exitCode).toBe(1)
    process.exitCode = undefined
  })

  it('requires --project-id', async () => {
    const spy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    await expect(run(tempDir, '--token', 'tok')).rejects.toThrow()
    spy.mockRestore()
  })
})
