import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { listStreamlitApps } from '@deepnote/cloud'
import { type MockDeepnoteCloud, startMockDeepnoteCloud } from '@deepnote/cloud-mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProgram } from '../cli'
import { resetOutputConfig } from '../output'

const ALPHA_ID = '2f7c1b3a-4d5e-4f60-8a1b-2c3d4e5f6a7b'
const TOKEN = 'test-token'
const ENTRYPOINT = 'apps/dashboard.py'
const V1 = 'import streamlit as st\nst.write("v1")\n'
const V2 = 'import streamlit as st\nst.write("v2")\n'
const CLOUD_EDIT = 'import streamlit as st\nst.write("edited in Deepnote")\n'
const ALPHA_DOCUMENT = `version: 1.0.0
metadata:
  createdAt: '2026-01-01T00:00:00.000Z'
  modifiedAt: '2026-01-01T00:00:00.000Z'
project:
  id: ${ALPHA_ID}
  name: Alpha
  notebooks:
    - id: nb-main
      name: Main
      blocks: []
`

let cloud: MockDeepnoteCloud
let workspace: string
let localFile: string
let cloudFile: string
let previousCwd: string
let output: string[]

async function deepnote(...args: string[]): Promise<void> {
  output = []
  await createProgram().parseAsync(['node', 'deepnote', '--no-color', ...args, '--url', cloud.url, '--token', TOKEN])
}

function publish(...flags: string[]): Promise<void> {
  return deepnote('streamlit', 'publish', ENTRYPOINT, '--project-id', ALPHA_ID, ...flags)
}

beforeEach(async () => {
  process.exitCode = undefined
  cloud = await startMockDeepnoteCloud()
  await fs.mkdir(path.join(cloud.rootDir, ALPHA_ID))
  await fs.writeFile(path.join(cloud.rootDir, ALPHA_ID, 'main.deepnote'), ALPHA_DOCUMENT)
  workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'streamlit-publish-cloud-mock-')))
  localFile = path.join(workspace, 'Alpha', '.files', ENTRYPOINT)
  cloudFile = path.join(cloud.rootDir, ALPHA_ID, '.files', ENTRYPOINT)
  output = []
  vi.spyOn(console, 'log').mockImplementation(message => {
    output.push(String(message))
  })
  vi.spyOn(console, 'error').mockImplementation(message => {
    output.push(String(message))
  })

  await deepnote('sync', workspace)
  await fs.mkdir(path.dirname(localFile), { recursive: true })
  await fs.writeFile(localFile, V1)
  previousCwd = process.cwd()
  process.chdir(path.join(workspace, 'Alpha', '.files'))
})

afterEach(async () => {
  process.chdir(previousCwd)
  process.exitCode = undefined
  vi.restoreAllMocks()
  resetOutputConfig()
  await cloud.stop()
  await fs.rm(workspace, { recursive: true, force: true })
})

describe('deepnote streamlit publish --upload against the Deepnote Cloud mock', () => {
  it('uploads the entrypoint from the sync folder, serves it, and records it so the next sync keeps a later local edit', async () => {
    await publish('--upload')

    expect(process.exitCode).toBeUndefined()
    expect(await fs.readFile(cloudFile, 'utf8')).toBe(V1)
    const apps = await listStreamlitApps(cloud.url, TOKEN, ALPHA_ID)
    expect(apps).toEqual([expect.objectContaining({ entrypoint: ENTRYPOINT })])
    expect(output.join('\n')).toContain(`Streamlit app URL: ${apps[0].url}`)

    await fs.writeFile(localFile, V2)
    await deepnote('sync', workspace, '--all-files')

    expect(await fs.readFile(localFile, 'utf8')).toBe(V2)
  })

  it('replaces the file in place on the next upload and keeps serving it from the same app', async () => {
    await publish('--upload')
    const apps = await listStreamlitApps(cloud.url, TOKEN, ALPHA_ID)
    await fs.writeFile(localFile, V2)

    await publish('--upload')

    expect(process.exitCode).toBeUndefined()
    expect(await fs.readdir(path.dirname(cloudFile))).toEqual(['dashboard.py'])
    expect(await fs.readFile(cloudFile, 'utf8')).toBe(V2)
    expect(await listStreamlitApps(cloud.url, TOKEN, ALPHA_ID)).toEqual(apps)
    expect(output.join('\n')).toContain(`${ENTRYPOINT} is already served by app ${apps[0].id}`)
  })

  it('refuses to overwrite a file changed in Deepnote since the previous upload recorded it', async () => {
    await publish('--upload')
    await fs.writeFile(cloudFile, CLOUD_EDIT)
    await fs.writeFile(localFile, V2)

    await publish('--upload')

    expect(process.exitCode).toBe(1)
    expect(await fs.readFile(cloudFile, 'utf8')).toBe(CLOUD_EDIT)
    expect(output.join('\n')).toContain(`Run \`deepnote sync ${workspace} --all-files\``)
  })
})
