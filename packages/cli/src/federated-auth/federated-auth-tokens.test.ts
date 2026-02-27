import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getDefaultTokensFilePath,
  getTokenForIntegration,
  readTokensFile,
  saveTokenForIntegration,
  writeTokensFile,
} from './federated-auth-tokens'

const testDir = path.join(os.tmpdir(), `deepnote-federated-auth-tokens-test-${Date.now()}`)

describe('federated-auth-tokens', () => {
  it('getDefaultTokensFilePath returns path in home directory', () => {
    const filePath = getDefaultTokensFilePath()
    expect(filePath).toContain('.deepnote')
    expect(filePath).toContain('federated-auth-tokens.yaml')
    expect(filePath).toMatch(new RegExp(`^${path.join(os.homedir(), '.deepnote')}`))
  })

  it('readTokensFile returns empty when file does not exist', async () => {
    const result = await readTokensFile(path.join(testDir, 'nonexistent.yaml'))
    expect(result.tokens).toEqual([])
    expect(result.issues).toEqual([])
  })

  it('writeTokensFile and readTokensFile round-trip', async () => {
    const testPath = path.join(testDir, 'tokens.yaml')
    await fs.mkdir(path.dirname(testPath), { recursive: true })

    const tokens = [
      {
        integrationId: 'int-1',
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        expiresAt: '2026-02-25T15:30:00.000Z',
      },
    ]

    await writeTokensFile(tokens, testPath)
    const result = await readTokensFile(testPath)
    expect(result.tokens).toEqual(tokens)
    expect(result.issues).toEqual([])
  })

  it('getTokenForIntegration finds matching entry', async () => {
    const testPath = path.join(testDir, 'get-token.yaml')
    await fs.mkdir(path.dirname(testPath), { recursive: true })
    await writeTokensFile(
      [
        { integrationId: 'int-a', accessToken: 'a', refreshToken: 'ra' },
        { integrationId: 'int-b', accessToken: 'b', refreshToken: 'rb' },
      ],
      testPath
    )

    const tokenA = await getTokenForIntegration('int-a', testPath)
    expect(tokenA).toEqual({ integrationId: 'int-a', accessToken: 'a', refreshToken: 'ra' })

    const tokenB = await getTokenForIntegration('int-b', testPath)
    expect(tokenB).toEqual({ integrationId: 'int-b', accessToken: 'b', refreshToken: 'rb' })

    const tokenC = await getTokenForIntegration('int-c', testPath)
    expect(tokenC).toBeUndefined()
  })

  it('saveTokenForIntegration upserts by integrationId', async () => {
    const testPath = path.join(testDir, 'save-token.yaml')
    await fs.mkdir(path.dirname(testPath), { recursive: true })

    await saveTokenForIntegration({ integrationId: 'int-1', accessToken: 'a1', refreshToken: 'r1' }, testPath)
    let result = await readTokensFile(testPath)
    expect(result.tokens).toHaveLength(1)
    expect(result.tokens[0].accessToken).toBe('a1')

    await saveTokenForIntegration({ integrationId: 'int-1', accessToken: 'a2', refreshToken: 'r2' }, testPath)
    result = await readTokensFile(testPath)
    expect(result.tokens).toHaveLength(1)
    expect(result.tokens[0].accessToken).toBe('a2')

    await saveTokenForIntegration({ integrationId: 'int-2', accessToken: 'a3', refreshToken: 'r3' }, testPath)
    result = await readTokensFile(testPath)
    expect(result.tokens).toHaveLength(2)
    expect(result.tokens.find(t => t.integrationId === 'int-1')?.accessToken).toBe('a2')
    expect(result.tokens.find(t => t.integrationId === 'int-2')?.accessToken).toBe('a3')
  })
})
