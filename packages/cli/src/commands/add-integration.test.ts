import crypto from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock output functions to suppress console output during tests
vi.mock('../output', () => ({
  debug: vi.fn(),
  log: vi.fn(),
  output: vi.fn(),
  error: vi.fn(),
}))

import {
  createIntegration,
  promptForFields,
  promptForIntegrationName,
  promptForIntegrationType,
} from './add-integration'

/**
 * Creates a mock input/output context for testing inquirer prompts.
 * The input stream simulates user keyboard input, the output stream captures prompt rendering.
 */
async function createPromptContext() {
  const MuteStream = (await import('mute-stream')).default
  const inputStream = new MuteStream()
  inputStream.unmute()
  const outputStream = new PassThrough()

  const typeText = (text: string) => {
    inputStream.write(text)
    for (const char of text) {
      inputStream.emit('keypress', null, { name: char })
    }
  }

  const pressEnter = () => {
    inputStream.emit('keypress', null, { name: 'enter' })
  }

  const typeAndEnter = (text: string) => {
    typeText(text)
    pressEnter()
  }

  const pressKey = (name: string) => {
    inputStream.emit('keypress', null, { name })
  }

  const tick = () => new Promise<void>(r => setTimeout(r, 50))

  const getOutput = (): string => {
    const chunks: Buffer[] = []
    for (;;) {
      const chunk = outputStream.read() as Buffer | null
      if (chunk === null) break
      chunks.push(chunk)
    }
    return Buffer.concat(chunks).toString('utf-8')
  }

  return {
    context: { input: inputStream, output: outputStream },
    typeText,
    pressEnter,
    typeAndEnter,
    pressKey,
    tick,
    getOutput,
    inputStream,
    outputStream,
  }
}

describe('create-integration command', () => {
  let tempDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `create-integration-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('promptForIntegrationType', () => {
    it('returns the selected integration type', async () => {
      const { context, typeText, pressEnter, tick } = await createPromptContext()

      const promise = promptForIntegrationType(context)
      await tick()

      // Select prompt: type to filter, then enter
      typeText('pgsql')
      await tick()
      pressEnter()

      const result = await promise
      expect(result).toMatchInlineSnapshot(`"pgsql"`)
    })

    it('can select mongodb type', async () => {
      const { context, typeText, pressEnter, tick } = await createPromptContext()

      const promise = promptForIntegrationType(context)
      await tick()

      typeText('mongodb')
      await tick()
      pressEnter()

      const result = await promise
      expect(result).toMatchInlineSnapshot(`"mongodb"`)
    })
  })

  describe('promptForIntegrationName', () => {
    it('returns the entered name', async () => {
      const { context, typeAndEnter, tick } = await createPromptContext()

      const promise = promptForIntegrationName(context)
      await tick()

      typeAndEnter('My Postgres DB')

      const result = await promise
      expect(result).toMatchInlineSnapshot(`"My Postgres DB"`)
    })

    it('rejects empty name with validation error', async () => {
      const { context, pressEnter, typeAndEnter, tick } = await createPromptContext()

      const promise = promptForIntegrationName(context)
      await tick()

      // Submit empty
      pressEnter()
      await tick()

      // Now type valid name
      typeAndEnter('Valid Name')

      const result = await promise
      expect(result).toMatchInlineSnapshot(`"Valid Name"`)
    })
  })

  describe('promptForFields', () => {
    it('collects all pgsql fields from user input', async () => {
      const { context, typeAndEnter, pressEnter, tick } = await createPromptContext()

      const promise = promptForFields('pgsql', context)
      await tick()

      // Host
      typeAndEnter('localhost')
      await tick()

      // Port (accept default)
      pressEnter()
      await tick()

      // Database
      typeAndEnter('mydb')
      await tick()

      // User
      typeAndEnter('admin')
      await tick()

      // Password
      typeAndEnter('secret123')

      const result = await promise
      expect(result).toMatchInlineSnapshot(`
        {
          "database": "mydb",
          "host": "localhost",
          "password": "secret123",
          "port": "5432",
          "user": "admin",
        }
      `)
    })

    it('throws not-implemented error for mysql', async () => {
      await expect(promptForFields('mysql')).rejects.toThrow('Integration type "mysql" is not yet implemented')
    })

    it('throws not-implemented error for mongodb', async () => {
      await expect(promptForFields('mongodb')).rejects.toThrow('not yet implemented')
    })

    it('throws not-implemented error for snowflake', async () => {
      await expect(promptForFields('snowflake')).rejects.toThrow('not yet implemented')
    })

    it('password field does not appear in output as plaintext', async () => {
      const { context, typeAndEnter, pressEnter, tick, outputStream } = await createPromptContext()

      // Capture all output
      let allOutput = ''
      outputStream.on('data', (chunk: Buffer) => {
        allOutput += chunk.toString('utf-8')
      })

      const promise = promptForFields('pgsql', context)
      await tick()

      typeAndEnter('host')
      await tick()
      pressEnter() // port default
      await tick()
      typeAndEnter('db')
      await tick()
      typeAndEnter('user')
      await tick()
      typeAndEnter('mysecretpass')
      await tick()

      await promise

      // The raw output should contain mask characters, not the actual password
      // Strip ANSI escape codes for checking
      const { stripVTControlCharacters } = await import('node:util')
      const stripped = stripVTControlCharacters(allOutput)
      expect(stripped).not.toContain('mysecretpass')
    })
  })

  describe('createIntegration end-to-end', () => {
    it('creates a new YAML file with pgsql integration and stores secrets in .env', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      const mockUUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
      vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID as ReturnType<typeof crypto.randomUUID>)

      const { context, typeText, typeAndEnter, pressEnter, tick } = await createPromptContext()

      const promise = createIntegration({ file: filePath, envFile: envFilePath }, context)
      await tick()

      // Select pgsql
      typeText('pgsql')
      await tick()
      pressEnter()
      await tick()

      // Integration name
      typeAndEnter('My Test DB')
      await tick()

      // Host
      typeAndEnter('db.example.com')
      await tick()

      // Port (accept default)
      pressEnter()
      await tick()

      // Database
      typeAndEnter('production')
      await tick()

      // User
      typeAndEnter('dbadmin')
      await tick()

      // Password
      typeAndEnter('supersecret')

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')
      const envContent = await readFile(envFilePath, 'utf-8')

      expect(yamlContent).toMatchInlineSnapshot(`
        "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

        integrations:
          - id: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
            name: My Test DB
            type: pgsql
            federated_auth_method: null
            metadata:
              host: db.example.com
              port: "5432"
              database: production
              user: dbadmin
              password: env:AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PASSWORD
        "
      `)

      // Password should not be plaintext in YAML
      expect(yamlContent).not.toContain('supersecret')

      expect(envContent).toMatchInlineSnapshot(`
        "AAAAAAAA_BBBB_CCCC_DDDD_EEEEEEEEEEEE__PASSWORD=supersecret
        "
      `)
    })

    it('appends to an existing integrations file without losing existing entries', async () => {
      const filePath = join(tempDir, 'existing.yaml')
      const envFilePath = join(tempDir, '.env')

      await writeFile(
        filePath,
        `integrations:
  - id: existing-id
    name: Existing DB
    type: pgsql
    metadata:
      host: existing.example.com
`
      )

      const mockUUID = 'new-uuid-1234-5678-abcdefabcdef'
      vi.spyOn(crypto, 'randomUUID').mockReturnValue(mockUUID as ReturnType<typeof crypto.randomUUID>)

      const { context, typeText, typeAndEnter, pressEnter, tick } = await createPromptContext()

      const promise = createIntegration({ file: filePath, envFile: envFilePath }, context)
      await tick()

      typeText('pgsql')
      await tick()
      pressEnter()
      await tick()
      typeAndEnter('New DB')
      await tick()
      typeAndEnter('new.example.com')
      await tick()
      pressEnter() // port default
      await tick()
      typeAndEnter('newdb')
      await tick()
      typeAndEnter('newuser')
      await tick()
      typeAndEnter('newpass')

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')

      expect(yamlContent).toMatchInlineSnapshot(`
        "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

        integrations:
          - id: existing-id
            name: Existing DB
            type: pgsql
            metadata:
              host: existing.example.com
          - id: new-uuid-1234-5678-abcdefabcdef
            name: New DB
            type: pgsql
            federated_auth_method: null
            metadata:
              host: new.example.com
              port: "5432"
              database: newdb
              user: newuser
              password: env:NEW_UUID_1234_5678_ABCDEFABCDEF__PASSWORD
        "
      `)
    })

    it('adds yaml-language-server schema comment to new files', async () => {
      const filePath = join(tempDir, 'schema-test.yaml')
      const envFilePath = join(tempDir, 'schema-test.env')

      vi.spyOn(crypto, 'randomUUID').mockReturnValue('test-uuid' as ReturnType<typeof crypto.randomUUID>)

      const { context, typeText, typeAndEnter, pressEnter, tick } = await createPromptContext()

      const promise = createIntegration({ file: filePath, envFile: envFilePath }, context)
      await tick()

      typeText('pgsql')
      await tick()
      pressEnter()
      await tick()
      typeAndEnter('Test DB')
      await tick()
      typeAndEnter('host')
      await tick()
      pressEnter()
      await tick()
      typeAndEnter('db')
      await tick()
      typeAndEnter('user')
      await tick()
      typeAndEnter('pass')

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')
      expect(yamlContent).toMatchInlineSnapshot(`
        "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

        integrations:
          - id: test-uuid
            name: Test DB
            type: pgsql
            federated_auth_method: null
            metadata:
              host: host
              port: "5432"
              database: db
              user: user
              password: env:TEST_UUID__PASSWORD
        "
      `)
    })

    it('rejects non-pgsql types with not-implemented error during full flow', async () => {
      const filePath = join(tempDir, 'not-impl.yaml')
      const envFilePath = join(tempDir, 'not-impl.env')

      const { context, typeText, typeAndEnter, pressEnter, tick } = await createPromptContext()

      const promise = createIntegration({ file: filePath, envFile: envFilePath }, context)
      await tick()

      // Select mysql
      typeText('mysql')
      await tick()
      pressEnter()
      await tick()

      // Name
      typeAndEnter('MySQL DB')

      await expect(promise).rejects.toThrow('not yet implemented')
    })

    it('generates a unique ID for each new integration', async () => {
      const filePath = join(tempDir, 'uuid-test.yaml')
      const envFilePath = join(tempDir, 'uuid-test.env')

      const expectedUUID = '11111111-2222-3333-4444-555555555555'
      vi.spyOn(crypto, 'randomUUID').mockReturnValue(expectedUUID as ReturnType<typeof crypto.randomUUID>)

      const { context, typeText, typeAndEnter, pressEnter, tick } = await createPromptContext()

      const promise = createIntegration({ file: filePath, envFile: envFilePath }, context)
      await tick()

      typeText('pgsql')
      await tick()
      pressEnter()
      await tick()
      typeAndEnter('UUID Test')
      await tick()
      typeAndEnter('host')
      await tick()
      pressEnter()
      await tick()
      typeAndEnter('db')
      await tick()
      typeAndEnter('user')
      await tick()
      typeAndEnter('pass')

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')
      expect(yamlContent).toMatchInlineSnapshot(`
        "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

        integrations:
          - id: 11111111-2222-3333-4444-555555555555
            name: UUID Test
            type: pgsql
            federated_auth_method: null
            metadata:
              host: host
              port: "5432"
              database: db
              user: user
              password: env:11111111_2222_3333_4444_555555555555__PASSWORD
        "
      `)
    })
  })
})
