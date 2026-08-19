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
    expect(spy).toHaveBeenCalledWith(2)
    spy.mockRestore()
  })

  it('exits with code 2 when directory is empty', async () => {
    const spy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    await expect(run(tempDir, '--project-id', 'p1', '--token', 'tok')).rejects.toThrow()
    expect(spy).toHaveBeenCalledWith(2)
    spy.mockRestore()
  })

  it('exits with code 2 when no token is available, rather than rejecting', async () => {
    // `program.parse()` does not await the action, so a thrown MissingTokenError would escape as an
    // unhandled rejection instead of the documented exit code.
    const previous = process.env.DEEPNOTE_TOKEN
    process.env.DEEPNOTE_TOKEN = ''
    const spy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })
    await fs.writeFile(join(tempDir, 'index.html'), 'hi')

    await expect(run(tempDir, '--project-id', 'p1')).rejects.toThrow()
    expect(spy).toHaveBeenCalledWith(2)
    spy.mockRestore()
    if (previous === undefined) {
      process.env.DEEPNOTE_TOKEN = undefined
      delete process.env.DEEPNOTE_TOKEN
    } else {
      process.env.DEEPNOTE_TOKEN = previous
    }
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

  it('keeps uploading after a file it cannot read', async () => {
    // The read sits inside the per-file try, so one bad file costs one file rather than the rest of
    // the publish.
    await fs.writeFile(join(tempDir, 'good.html'), 'ok')
    await fs.writeFile(join(tempDir, 'bad.html'), 'nope')
    mockedUpload.mockResolvedValue({ projectId: 'p1', path: '' })
    const realReadFile = fs.readFile
    const readFile = vi
      .spyOn(fs, 'readFile')
      .mockImplementation(((target: Parameters<typeof fs.readFile>[0]) =>
        String(target).endsWith('bad.html')
          ? Promise.reject(new Error('EACCES: permission denied'))
          : realReadFile(target)) as typeof fs.readFile)

    await run(tempDir, '--project-id', 'p1', '--token', 'tok', '-q')
    readFile.mockRestore()

    expect(mockedUpload).toHaveBeenCalledTimes(1)
    expect(mockedUpload.mock.calls[0]?.[3]).toBe('_deepnote_static/good.html')
    expect(process.exitCode).toBe(1)
    process.exitCode = undefined
  })

  it('points the static site URL at the subpath that --path uploaded into', async () => {
    await fs.writeFile(join(tempDir, 'index.html'), 'hi')
    mockedUpload.mockResolvedValue({ projectId: 'p1', path: '' })
    const logged: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation(msg => {
      logged.push(String(msg))
    })

    await run(tempDir, '--project-id', 'p1', '--token', 'tok', '--path', '_deepnote_static/v2')
    spy.mockRestore()

    expect(logged.join('\n')).toContain('https://deepnote.com/static-files/p1/v2/')
  })

  it('advertises no static site URL when the target is outside the static root', async () => {
    await fs.writeFile(join(tempDir, 'index.html'), 'hi')
    mockedUpload.mockResolvedValue({ projectId: 'p1', path: '' })
    const logged: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation(msg => {
      logged.push(String(msg))
    })

    await run(tempDir, '--project-id', 'p1', '--token', 'tok', '--path', 'elsewhere/assets')
    spy.mockRestore()

    const output = logged.join('\n')
    expect(output).not.toContain('static-files/p1')
    expect(output).toContain('not served as a static site')
  })

  it('requires --project-id', async () => {
    const spy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })

    await expect(run(tempDir, '--token', 'tok')).rejects.toThrow()
    spy.mockRestore()
  })
})
