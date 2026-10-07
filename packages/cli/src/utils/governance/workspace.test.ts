import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadWorkspace, projectBlocks } from './workspace'

/** Aim an EACCES at one directory, so the permission behaviour is testable as any user. */
const readdirFailure = vi.hoisted(() => ({ path: undefined as string | undefined }))

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    default: actual,
    readdir: (async (path: string, options?: unknown) => {
      if (readdirFailure.path !== undefined && path === readdirFailure.path) {
        throw Object.assign(new Error(`EACCES: permission denied, scandir '${path}'`), { code: 'EACCES' })
      }
      return (actual.readdir as (p: string, o?: unknown) => Promise<unknown>)(path, options)
    }) as typeof actual.readdir,
  }
})

let root: string

/** Write a minimal `.deepnote` file for `project` at `relativePath`. */
async function writeProjectFile(
  relativePath: string,
  project: {
    id: string
    name: string
    notebooks: Array<{ id: string; name: string; blocks?: Array<{ id: string; type: string; content: string }> }>
    integrations?: Array<{ id: string; name: string; type: string }>
    modifiedAt?: string
  }
): Promise<void> {
  const path = join(root, relativePath)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(
    path,
    JSON.stringify({
      version: '1',
      metadata: { createdAt: '2025-01-01T00:00:00.000Z', modifiedAt: project.modifiedAt },
      project: {
        id: project.id,
        name: project.name,
        ...(project.integrations ? { integrations: project.integrations } : {}),
        notebooks: project.notebooks.map(notebook => ({
          id: notebook.id,
          name: notebook.name,
          blocks: (notebook.blocks ?? []).map((block, index) => ({
            blockGroup: `${block.id}-group`,
            id: block.id,
            type: block.type,
            content: block.content,
            metadata: {},
            sortingKey: `a${index}`,
          })),
        })),
      },
    })
  )
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'deepnote-workspace-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('loadWorkspace', () => {
  it('loads one project per directory', async () => {
    await writeProjectFile('marketing/campaigns.deepnote', {
      id: 'p1',
      name: 'Marketing',
      notebooks: [{ id: 'n1', name: 'Campaigns', blocks: [{ id: 'b1', type: 'code', content: 'x = 1' }] }],
    })

    const workspace = await loadWorkspace(root)

    expect(workspace.fileCount).toBe(1)
    expect(workspace.projects).toHaveLength(1)
    expect(workspace.projects[0]).toMatchObject({ id: 'p1', name: 'Marketing', dir: 'marketing' })
    expect(workspace.projects[0].notebooks[0].path).toBe(join('marketing', 'campaigns.deepnote'))
  })

  it('reassembles a project spread across one file per notebook', async () => {
    await writeProjectFile('finance/first.deepnote', {
      id: 'p1',
      name: 'Finance',
      notebooks: [{ id: 'n1', name: 'First' }],
      integrations: [{ id: 'i1', name: 'Warehouse', type: 'snowflake' }],
      modifiedAt: '2026-01-01T00:00:00.000Z',
    })
    await writeProjectFile('finance/second.deepnote', {
      id: 'p1',
      name: 'Finance',
      notebooks: [{ id: 'n2', name: 'Second' }],
      integrations: [{ id: 'i2', name: 'Replica', type: 'postgres' }],
      modifiedAt: '2026-06-01T00:00:00.000Z',
    })

    const workspace = await loadWorkspace(root)

    expect(workspace.projects).toHaveLength(1)
    expect(workspace.projects[0].notebooks.map(n => n.name)).toEqual(['First', 'Second'])
    expect(workspace.projects[0].integrations.map(i => i.id)).toEqual(['i1', 'i2'])
    expect(workspace.projects[0].modifiedAt).toBe('2026-06-01T00:00:00.000Z')
  })

  it('counts a notebook repeated across files once', async () => {
    // Sync composes the init notebook into every file of a project, so the same notebook id shows
    // up more than once and must not inflate the inventory.
    const init = { id: 'init', name: 'Init' }
    await writeProjectFile('p/a.deepnote', { id: 'p1', name: 'P', notebooks: [init, { id: 'n1', name: 'A' }] })
    await writeProjectFile('p/b.deepnote', { id: 'p1', name: 'P', notebooks: [init, { id: 'n2', name: 'B' }] })

    const workspace = await loadWorkspace(root)

    expect(workspace.projects[0].notebooks.map(n => n.id)).toEqual(['init', 'n1', 'n2'])
  })

  it('keys projects by id, not by name', async () => {
    await writeProjectFile('a/one.deepnote', { id: 'p1', name: 'Analysis', notebooks: [{ id: 'n1', name: 'A' }] })
    await writeProjectFile('b/two.deepnote', { id: 'p2', name: 'Analysis', notebooks: [{ id: 'n2', name: 'B' }] })

    expect((await loadWorkspace(root)).projects.map(p => p.id)).toEqual(['p1', 'p2'])
  })

  it('reduces a project split across directories to their common directory', async () => {
    await writeProjectFile('team/alpha/one.deepnote', { id: 'p1', name: 'P', notebooks: [{ id: 'n1', name: 'A' }] })
    await writeProjectFile('team/beta/two.deepnote', { id: 'p1', name: 'P', notebooks: [{ id: 'n2', name: 'B' }] })

    expect((await loadWorkspace(root)).projects[0].dir).toBe('team')
  })

  it('reports an unparseable file instead of failing the whole load', async () => {
    await writeProjectFile('good/ok.deepnote', { id: 'p1', name: 'Good', notebooks: [{ id: 'n1', name: 'A' }] })
    await mkdir(join(root, 'bad'), { recursive: true })
    await writeFile(join(root, 'bad', 'broken.deepnote'), 'project: [this is not a project')

    const workspace = await loadWorkspace(root)

    expect(workspace.projects.map(p => p.id)).toEqual(['p1'])
    expect(workspace.errors).toHaveLength(1)
    expect(workspace.errors[0].path).toBe(join('bad', 'broken.deepnote'))
    expect(workspace.fileCount).toBe(2)
  })

  it('skips dependency and VCS directories', async () => {
    await writeProjectFile('node_modules/pkg/fixture.deepnote', { id: 'p1', name: 'Vendored', notebooks: [] })
    await writeProjectFile('.git/fixture.deepnote', { id: 'p2', name: 'Git', notebooks: [] })
    await writeProjectFile('real/project.deepnote', { id: 'p3', name: 'Real', notebooks: [] })

    expect((await loadWorkspace(root)).projects.map(p => p.id)).toEqual(['p3'])
  })

  it('accepts a single file as the workspace', async () => {
    await writeProjectFile('solo.deepnote', { id: 'p1', name: 'Solo', notebooks: [{ id: 'n1', name: 'A' }] })

    const workspace = await loadWorkspace(join(root, 'solo.deepnote'))

    expect(workspace.projects.map(p => p.name)).toEqual(['Solo'])
  })

  it('returns an empty workspace for a directory with no .deepnote files', async () => {
    const workspace = await loadWorkspace(root)

    expect(workspace).toMatchObject({ projects: [], errors: [], fileCount: 0 })
  })

  it('sorts projects by name so two runs over one tree agree', async () => {
    await writeProjectFile('c.deepnote', { id: 'p3', name: 'Charlie', notebooks: [] })
    await writeProjectFile('a.deepnote', { id: 'p1', name: 'Alpha', notebooks: [] })
    await writeProjectFile('b.deepnote', { id: 'p2', name: 'Bravo', notebooks: [] })

    expect((await loadWorkspace(root)).projects.map(p => p.name)).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })
})

describe('projectBlocks', () => {
  it('pairs every block with the notebook it came from', async () => {
    await writeProjectFile('p.deepnote', {
      id: 'p1',
      name: 'P',
      notebooks: [
        { id: 'n1', name: 'First', blocks: [{ id: 'b1', type: 'code', content: 'x = 1' }] },
        { id: 'n2', name: 'Second', blocks: [{ id: 'b2', type: 'sql', content: 'SELECT 1' }] },
      ],
    })

    const workspace = await loadWorkspace(root)

    expect(projectBlocks(workspace.projects[0]).map(({ block, notebook }) => [block.id, notebook.name])).toEqual([
      ['b1', 'First'],
      ['b2', 'Second'],
    ])
  })
})

/**
 * `chmod 0o000` does not stop root reading, and POSIX mode bits do not exist on Windows, so the
 * two tests below cannot bite in a root container. They are kept for the environments where they
 * are a real integration test, and the fault-injected test underneath covers everywhere else.
 */
const canRevokeRead = process.platform !== 'win32' && process.getuid?.() !== 0

describe.skipIf(!canRevokeRead)('loadWorkspace — unreadable directories', () => {
  it('throws when the root itself cannot be read, rather than reporting an empty workspace', async () => {
    // The failure this guards against: an audit that cannot open the directory reports zero
    // projects, therefore zero findings, and reads as a clean bill of health.
    const root = await mkdtemp(join(tmpdir(), 'deepnote-unreadable-'))
    await chmod(root, 0o000)

    try {
      await expect(loadWorkspace(root)).rejects.toThrow()
    } finally {
      await chmod(root, 0o755)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('records an unreadable subdirectory and keeps auditing the rest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'deepnote-partial-'))
    const readable = join(root, 'readable')
    const blocked = join(root, 'blocked')
    await mkdir(readable)
    await mkdir(blocked)
    await writeFile(
      join(readable, 'p.deepnote'),
      JSON.stringify({
        version: '1',
        metadata: { createdAt: '2025-01-01T00:00:00.000Z' },
        project: { id: 'p1', name: 'Alpha', notebooks: [{ id: 'n1', name: 'One', blocks: [] }] },
      })
    )
    await chmod(blocked, 0o000)

    try {
      const workspace = await loadWorkspace(root)

      expect(workspace.projects).toHaveLength(1)
      // Visible, not merely debug-logged: a folder the audit could not look into is a hole in the
      // report and the report has to say so.
      expect(workspace.errors.map(error => error.path)).toContain('blocked')
    } finally {
      await chmod(blocked, 0o755)
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('loadWorkspace — an unreadable root, injected', () => {
  // The same guarantee as above, but independent of who the test runs as: a CI container running
  // as root would skip the chmod tests entirely, and this is the one failure mode that must never
  // go uncovered — an audit that cannot read the workspace reporting no findings.
  it('throws rather than reporting an empty workspace', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'deepnote-eacces-'))
    try {
      readdirFailure.path = dir
      await expect(loadWorkspace(dir)).rejects.toThrow(/EACCES/)
    } finally {
      readdirFailure.path = undefined
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('records an unreadable subdirectory instead of failing the run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'deepnote-eacces-sub-'))
    try {
      await mkdir(join(dir, 'blocked'))
      await writeFile(
        join(dir, 'ok.deepnote'),
        JSON.stringify({
          version: '1',
          metadata: { createdAt: '2025-01-01T00:00:00.000Z' },
          project: { id: 'p1', name: 'Alpha', notebooks: [{ id: 'n1', name: 'One', blocks: [] }] },
        })
      )
      readdirFailure.path = join(dir, 'blocked')

      const workspace = await loadWorkspace(dir)

      expect(workspace.projects).toHaveLength(1)
      expect(workspace.errors.map(error => error.path)).toContain('blocked')
    } finally {
      readdirFailure.path = undefined
      await rm(dir, { recursive: true, force: true })
    }
  })
})
