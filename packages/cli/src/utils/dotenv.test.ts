import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readDotEnv, updateDotEnv } from './dotenv'

describe('dotenv utilities', () => {
  let tempDir: string
  let envFilePath: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dotenv-test-'))
    envFilePath = path.join(tempDir, '.env')
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe('readDotEnv', () => {
    it('parses standard KEY=value pairs', async () => {
      await fs.writeFile(envFilePath, 'MY_VAR=hello\nANOTHER=world\n')
      const result = await readDotEnv(envFilePath)
      expect(result).toEqual({ MY_VAR: 'hello', ANOTHER: 'world' })
    })

    it('handles double-quoted values', async () => {
      await fs.writeFile(envFilePath, 'MY_VAR="hello world"\n')
      const result = await readDotEnv(envFilePath)
      expect(result).toEqual({ MY_VAR: 'hello world' })
    })

    it('handles single-quoted values', async () => {
      await fs.writeFile(envFilePath, "MY_VAR='hello world'\n")
      const result = await readDotEnv(envFilePath)
      expect(result).toEqual({ MY_VAR: 'hello world' })
    })

    it('handles values with equals signs', async () => {
      await fs.writeFile(envFilePath, 'MY_VAR=pass=word=123\n')
      const result = await readDotEnv(envFilePath)
      expect(result).toEqual({ MY_VAR: 'pass=word=123' })
    })

    it('handles empty values', async () => {
      await fs.writeFile(envFilePath, 'MY_VAR=\n')
      const result = await readDotEnv(envFilePath)
      expect(result).toEqual({ MY_VAR: '' })
    })

    it('ignores comments', async () => {
      await fs.writeFile(envFilePath, '# This is a comment\nMY_VAR=hello\n# Another comment\n')
      const result = await readDotEnv(envFilePath)
      expect(result).toEqual({ MY_VAR: 'hello' })
    })

    it('ignores empty lines', async () => {
      await fs.writeFile(envFilePath, 'MY_VAR=hello\n\nANOTHER=world\n')
      const result = await readDotEnv(envFilePath)
      expect(result).toEqual({ MY_VAR: 'hello', ANOTHER: 'world' })
    })

    it('returns empty object for missing file', async () => {
      const result = await readDotEnv(path.join(tempDir, 'nonexistent.env'))
      expect(result).toEqual({})
    })

    it('skips malformed lines without equals sign', async () => {
      await fs.writeFile(envFilePath, 'VALID=value\nINVALID LINE\nANOTHER=test\n')
      const result = await readDotEnv(envFilePath)
      expect(result).toEqual({ VALID: 'value', ANOTHER: 'test' })
    })

    it('handles escape sequences in double-quoted values', async () => {
      await fs.writeFile(envFilePath, 'MY_VAR="line1\\nline2"\n')
      const result = await readDotEnv(envFilePath)
      expect(result).toEqual({ MY_VAR: 'line1\nline2' })
    })

    it('handles escaped quotes in double-quoted values', async () => {
      // Note: dotenv package preserves backslash-escaped quotes as-is
      await fs.writeFile(envFilePath, 'MY_VAR="hello \\"world\\""\n')
      const result = await readDotEnv(envFilePath)
      expect(result).toEqual({ MY_VAR: 'hello \\"world\\"' })
    })
  })

  describe('updateDotEnv', () => {
    it('creates new file with variables', async () => {
      await updateDotEnv(envFilePath, { MY_VAR: 'hello', ANOTHER: 'world' })
      const result = await readDotEnv(envFilePath)
      expect(result).toEqual({ MY_VAR: 'hello', ANOTHER: 'world' })
    })

    it('updates existing variable value', async () => {
      await fs.writeFile(envFilePath, 'MY_VAR=old_value\n')
      await updateDotEnv(envFilePath, { MY_VAR: 'new_value' })
      const result = await readDotEnv(envFilePath)
      expect(result).toEqual({ MY_VAR: 'new_value' })
    })

    it('appends new variables at end', async () => {
      await fs.writeFile(envFilePath, 'EXISTING=value\n')
      await updateDotEnv(envFilePath, { NEW_VAR: 'new_value' })
      const result = await readDotEnv(envFilePath)
      expect(result).toEqual({ EXISTING: 'value', NEW_VAR: 'new_value' })
    })

    it('preserves existing variables not in updates', async () => {
      await fs.writeFile(envFilePath, 'KEEP_ME=original\nUPDATE_ME=old\n')
      await updateDotEnv(envFilePath, { UPDATE_ME: 'new' })
      const result = await readDotEnv(envFilePath)
      expect(result).toEqual({ KEEP_ME: 'original', UPDATE_ME: 'new' })
    })

    it('preserves comments', async () => {
      await fs.writeFile(envFilePath, '# Database credentials\nDB_PASS=secret\n')
      await updateDotEnv(envFilePath, { DB_PASS: 'new_secret' })
      const content = await fs.readFile(envFilePath, 'utf-8')
      expect(content).toContain('# Database credentials')
    })

    it('preserves empty lines', async () => {
      await fs.writeFile(envFilePath, 'VAR1=value1\n\nVAR2=value2\n')
      await updateDotEnv(envFilePath, { VAR1: 'updated' })
      const content = await fs.readFile(envFilePath, 'utf-8')
      expect(content).toContain('\n\n')
    })

    it('handles values with special characters', async () => {
      await updateDotEnv(envFilePath, { MY_VAR: 'pass$word#test' })
      const result = await readDotEnv(envFilePath)
      expect(result).toEqual({ MY_VAR: 'pass$word#test' })
    })

    it('handles values with spaces', async () => {
      await updateDotEnv(envFilePath, { MY_VAR: 'hello world' })
      const result = await readDotEnv(envFilePath)
      expect(result).toEqual({ MY_VAR: 'hello world' })
    })

    it('handles values with newlines', async () => {
      await updateDotEnv(envFilePath, { MY_VAR: 'line1\nline2' })
      const result = await readDotEnv(envFilePath)
      expect(result).toEqual({ MY_VAR: 'line1\nline2' })
    })

    it('handles values with quotes', async () => {
      await updateDotEnv(envFilePath, { MY_VAR: 'say "hello"' })
      const result = await readDotEnv(envFilePath)
      expect(result).toEqual({ MY_VAR: 'say "hello"' })
    })

    it('handles env: prefix values without resolving them', async () => {
      await updateDotEnv(envFilePath, { MY_VAR: 'env:SOME_OTHER_VAR' })
      const result = await readDotEnv(envFilePath)
      expect(result).toEqual({ MY_VAR: 'env:SOME_OTHER_VAR' })
    })

    it('handles very long values', async () => {
      const longValue = 'a'.repeat(5000)
      await updateDotEnv(envFilePath, { MY_VAR: longValue })
      const result = await readDotEnv(envFilePath)
      expect(result).toEqual({ MY_VAR: longValue })
    })

    it('creates parent directories if needed', async () => {
      const nestedPath = path.join(tempDir, 'nested', 'dir', '.env')
      await updateDotEnv(nestedPath, { MY_VAR: 'value' })
      const result = await readDotEnv(nestedPath)
      expect(result).toEqual({ MY_VAR: 'value' })
    })

    it('handles empty existing file', async () => {
      await fs.writeFile(envFilePath, '')
      await updateDotEnv(envFilePath, { MY_VAR: 'value' })
      const result = await readDotEnv(envFilePath)
      expect(result).toEqual({ MY_VAR: 'value' })
    })
  })
})
