import fs from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanAppBuild } from './viewer-scope-scan'

describe('scanAppBuild', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(os.tmpdir(), 'app-build-scan-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('reports out-of-scope paths per file, with forward slashes, sorted', async () => {
    await fs.mkdir(join(dir, 'assets', 'js'), { recursive: true })
    await fs.writeFile(join(dir, 'index.html'), "<script>fetch('/v2/projects')</script>")
    await fs.writeFile(join(dir, 'assets', 'js', 'app.mjs'), "fetch('/v2/runs'); fetch('/v2/me')")

    const scan = await scanAppBuild(dir)

    expect(scan.outOfScope).toEqual([
      { file: 'assets/js/app.mjs', paths: ['/v2/me'] },
      { file: 'index.html', paths: ['/v2/projects'] },
    ])
    expect(scan.apiFiles).toEqual(['assets/js/app.mjs', 'index.html'])
    expect(scan.hasTokenHandshake).toBe(false)
  })

  it('finds calls to the local serveStatic routes', async () => {
    await fs.writeFile(
      join(dir, 'app.js'),
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal `${…}` is what the scan reads
      "fetch('/api/info'); fetch('/api/run', { method: 'POST' }); fetch(`/api/cloud-runs/${id}`); fetch('/api/run')"
    )
    await fs.writeFile(join(dir, 'other.js'), "fetch('/api/runner'); fetch('/api/users')")

    const scan = await scanAppBuild(dir)

    // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal `${…}` is what the scan reads
    const templateRoute = '/api/cloud-runs/${id}'
    expect(scan.localServerCalls).toEqual([{ file: 'app.js', paths: ['/api/info', '/api/run', templateRoute] }])
    expect(scan.apiFiles).toEqual([])
  })

  it('recognizes the token handshake, as bundled by @deepnote/app-client', async () => {
    await fs.writeFile(join(dir, 'app-client.js'), "postMessage({ type: 'deepnote-static-files-api-token-request' })")
    await fs.writeFile(join(dir, 'app.js'), "fetch('/v2/runs')")

    expect((await scanAppBuild(dir)).hasTokenHandshake).toBe(true)
  })

  it('skips node_modules, non-script files, public API docs, and in-scope calls', async () => {
    await fs.mkdir(join(dir, 'node_modules', 'lib'), { recursive: true })
    await fs.writeFile(join(dir, 'node_modules', 'lib', 'index.js'), "fetch('/v2/projects'); fetch('/api/run')")
    await fs.writeFile(join(dir, 'notes.md'), '/v2/projects /api/run')
    await fs.writeFile(join(dir, 'app.js.map'), '/v2/projects')
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal `${…}` is what the scan reads
    await fs.writeFile(join(dir, 'app.js'), "fetch(`/v2/runs/${id}`); fetch('/v2/openapi.json')")
    await fs.writeFile(join(dir, 'docs.js'), "fetch('/v2/docs/apps')")

    const scan = await scanAppBuild(dir)

    expect(scan).toEqual({ outOfScope: [], localServerCalls: [], apiFiles: ['app.js'], hasTokenHandshake: false })
  })
})
