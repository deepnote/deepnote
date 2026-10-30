import fs from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanForOutOfScopeApiCalls } from './viewer-scope-scan'

describe('scanForOutOfScopeApiCalls', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(os.tmpdir(), 'viewer-scope-scan-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('reports out-of-scope paths per file, with forward slashes, sorted', async () => {
    await fs.mkdir(join(dir, 'assets', 'js'), { recursive: true })
    await fs.writeFile(join(dir, 'index.html'), "<script>fetch('/v2/projects')</script>")
    await fs.writeFile(join(dir, 'assets', 'js', 'app.mjs'), "fetch('/v2/runs'); fetch('/v2/me')")

    expect(await scanForOutOfScopeApiCalls(dir)).toEqual([
      { file: 'assets/js/app.mjs', paths: ['/v2/me'] },
      { file: 'index.html', paths: ['/v2/projects'] },
    ])
  })

  it('skips node_modules, non-script files, and in-scope calls', async () => {
    await fs.mkdir(join(dir, 'node_modules', 'lib'), { recursive: true })
    await fs.writeFile(join(dir, 'node_modules', 'lib', 'index.js'), "fetch('/v2/projects')")
    await fs.writeFile(join(dir, 'notes.md'), '/v2/projects')
    await fs.writeFile(join(dir, 'app.js.map'), '/v2/projects')
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal `${…}` is what the scan reads
    await fs.writeFile(join(dir, 'app.js'), 'fetch(`/v2/runs/${id}`)')

    expect(await scanForOutOfScopeApiCalls(dir)).toEqual([])
  })
})
