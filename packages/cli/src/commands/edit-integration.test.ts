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

import { editIntegration, promptSelectIntegration } from './edit-integration'

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

  return {
    context: { input: inputStream, output: outputStream },
    typeText,
    pressEnter,
    typeAndEnter,
    pressKey,
    tick,
    inputStream,
    outputStream,
  }
}

const EXISTING_YAML = `#yaml-language-server: $schema=https://example.com/schema.json

integrations:
  - id: pg-id-001
    name: Production DB
    type: pgsql
    federated_auth_method: null
    metadata:
      host: prod.example.com
      port: "5432"
      database: production
      user: admin
      password: env:PG_ID_001__PASSWORD
  - id: pg-id-002
    name: Staging DB
    type: pgsql
    federated_auth_method: null
    metadata:
      host: staging.example.com
      port: "5432"
      database: staging
      user: stg_user
      password: env:PG_ID_002__PASSWORD
`

describe('edit-integration command', () => {
  let tempDir: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    tempDir = join(tmpdir(), `edit-integration-test-${Date.now()}`)
    await mkdir(tempDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('promptSelectIntegration', () => {
    it('displays integration names and returns the selected one', async () => {
      const { context, pressEnter, tick } = await createPromptContext()

      const entries = [
        { id: 'id-1', name: 'DB One', type: 'pgsql', map: {} as never },
        { id: 'id-2', name: 'DB Two', type: 'mysql', map: {} as never },
      ]

      const promise = promptSelectIntegration(entries, context)
      await tick()

      // First entry is selected by default
      pressEnter()

      const result = await promise
      expect(result.id).toMatchInlineSnapshot(`"id-1"`)
      expect(result.name).toMatchInlineSnapshot(`"DB One"`)
    })

    it('can navigate to select a different integration', async () => {
      const { context, pressKey, pressEnter, tick } = await createPromptContext()

      const entries = [
        { id: 'id-1', name: 'DB One', type: 'pgsql', map: {} as never },
        { id: 'id-2', name: 'DB Two', type: 'mysql', map: {} as never },
      ]

      const promise = promptSelectIntegration(entries, context)
      await tick()

      pressKey('down')
      pressEnter()

      const result = await promise
      expect(result.id).toMatchInlineSnapshot(`"id-2"`)
      expect(result.name).toMatchInlineSnapshot(`"DB Two"`)
    })
  })

  describe('editIntegration end-to-end', () => {
    it('throws error when file does not exist', async () => {
      const filePath = join(tempDir, 'nonexistent.yaml')
      const envFilePath = join(tempDir, '.env')

      await expect(editIntegration({ file: filePath, envFile: envFilePath })).rejects.toThrow(
        'No integrations file found'
      )
    })

    it('throws error when file has no integrations', async () => {
      const filePath = join(tempDir, 'empty.yaml')
      const envFilePath = join(tempDir, '.env')

      await writeFile(filePath, 'integrations: []\n')

      await expect(editIntegration({ file: filePath, envFile: envFilePath })).rejects.toThrow('No integrations found')
    })

    it('throws error when id argument does not match any integration', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      await writeFile(filePath, EXISTING_YAML)

      await expect(editIntegration({ file: filePath, envFile: envFilePath, id: 'nonexistent-id' })).rejects.toThrow(
        'Integration with ID "nonexistent-id" not found'
      )
    })

    it('skips selection picker when id argument is provided', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      await writeFile(filePath, EXISTING_YAML)

      const { context, typeText, typeAndEnter, pressEnter, tick } = await createPromptContext()

      const promise = editIntegration({ file: filePath, envFile: envFilePath, id: 'pg-id-002' }, context)
      await tick()

      // Should go straight to name prompt (no select picker), and default to Staging DB
      typeText('\x15')
      typeAndEnter('Edited via ID')
      await tick()

      // Host - keep
      pressEnter()
      await tick()
      // Port - keep
      pressEnter()
      await tick()
      // Database - keep
      pressEnter()
      await tick()
      // User - keep
      pressEnter()
      await tick()
      // Password - keep
      pressEnter()

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')

      expect(yamlContent).toMatchInlineSnapshot(`
        "#yaml-language-server: $schema=https://example.com/schema.json

        integrations:
          - id: pg-id-001
            name: Production DB
            type: pgsql
            federated_auth_method: null
            metadata:
              host: prod.example.com
              port: "5432"
              database: production
              user: admin
              password: env:PG_ID_001__PASSWORD
          - id: pg-id-002
            name: Edited via ID
            type: pgsql
            federated_auth_method: null
            metadata:
              host: staging.example.com
              port: "5432"
              database: staging
              user: stg_user
              password: env:PG_ID_002__PASSWORD
        "
      `)
    })

    it('edits non-secret fields of a selected integration', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      await writeFile(filePath, EXISTING_YAML)
      await writeFile(envFilePath, 'PG_ID_001__PASSWORD=oldpass\nPG_ID_002__PASSWORD=oldpass2\n')

      const { context, typeText, typeAndEnter, pressEnter, tick } = await createPromptContext()

      const promise = editIntegration({ file: filePath, envFile: envFilePath }, context)
      await tick()

      // Select first integration (Production DB)
      pressEnter()
      await tick()

      // Name - change it
      // First clear existing default, then type new name
      // The input prompt pre-fills the default, pressing Ctrl+U clears it
      typeText('\x15') // Ctrl+U to clear
      typeAndEnter('Updated Production DB')
      await tick()

      // Host - change it
      typeText('\x15')
      typeAndEnter('new-prod.example.com')
      await tick()

      // Port - keep default
      pressEnter()
      await tick()

      // Database - change it
      typeText('\x15')
      typeAndEnter('new_production')
      await tick()

      // User - keep default
      pressEnter()
      await tick()

      // Password - press Enter to keep existing
      pressEnter()

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')

      expect(yamlContent).toMatchInlineSnapshot(`
        "#yaml-language-server: $schema=https://example.com/schema.json

        integrations:
          - id: pg-id-001
            name: Updated Production DB
            type: pgsql
            federated_auth_method: null
            metadata:
              host: new-prod.example.com
              port: "5432"
              database: new_production
              user: admin
              password: env:PG_ID_001__PASSWORD
          - id: pg-id-002
            name: Staging DB
            type: pgsql
            federated_auth_method: null
            metadata:
              host: staging.example.com
              port: "5432"
              database: staging
              user: stg_user
              password: env:PG_ID_002__PASSWORD
        "
      `)
    })

    it('updates a secret field and writes new value to .env', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      await writeFile(filePath, EXISTING_YAML)
      await writeFile(envFilePath, 'PG_ID_001__PASSWORD=oldpass\n')

      const { context, typeAndEnter, pressEnter, tick } = await createPromptContext()

      const promise = editIntegration({ file: filePath, envFile: envFilePath }, context)
      await tick()

      // Select first integration
      pressEnter()
      await tick()

      // Name - keep default
      pressEnter()
      await tick()

      // Host - keep default
      pressEnter()
      await tick()

      // Port - keep default
      pressEnter()
      await tick()

      // Database - keep default
      pressEnter()
      await tick()

      // User - keep default
      pressEnter()
      await tick()

      // Password - enter new password
      typeAndEnter('newpassword123')

      await promise

      const envContent = await readFile(envFilePath, 'utf-8')

      expect(envContent).toMatchInlineSnapshot(`
        "PG_ID_001__PASSWORD=newpassword123
        "
      `)

      // YAML should still have env: reference (not plaintext password)
      const yamlContent = await readFile(filePath, 'utf-8')
      expect(yamlContent).not.toContain('newpassword123')
      expect(yamlContent).toMatchInlineSnapshot(`
        "#yaml-language-server: $schema=https://example.com/schema.json

        integrations:
          - id: pg-id-001
            name: Production DB
            type: pgsql
            federated_auth_method: null
            metadata:
              host: prod.example.com
              port: "5432"
              database: production
              user: admin
              password: env:PG_ID_001__PASSWORD
          - id: pg-id-002
            name: Staging DB
            type: pgsql
            federated_auth_method: null
            metadata:
              host: staging.example.com
              port: "5432"
              database: staging
              user: stg_user
              password: env:PG_ID_002__PASSWORD
        "
      `)
    })

    it('can select and edit the second integration', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      await writeFile(filePath, EXISTING_YAML)

      const { context, typeText, typeAndEnter, pressKey, pressEnter, tick } = await createPromptContext()

      const promise = editIntegration({ file: filePath, envFile: envFilePath }, context)
      await tick()

      // Navigate to second integration
      pressKey('down')
      pressEnter()
      await tick()

      // Name - change it
      typeText('\x15')
      typeAndEnter('Updated Staging DB')
      await tick()

      // Host - keep
      pressEnter()
      await tick()

      // Port - keep
      pressEnter()
      await tick()

      // Database - keep
      pressEnter()
      await tick()

      // User - keep
      pressEnter()
      await tick()

      // Password - keep
      pressEnter()

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')

      expect(yamlContent).toMatchInlineSnapshot(`
        "#yaml-language-server: $schema=https://example.com/schema.json

        integrations:
          - id: pg-id-001
            name: Production DB
            type: pgsql
            federated_auth_method: null
            metadata:
              host: prod.example.com
              port: "5432"
              database: production
              user: admin
              password: env:PG_ID_001__PASSWORD
          - id: pg-id-002
            name: Updated Staging DB
            type: pgsql
            federated_auth_method: null
            metadata:
              host: staging.example.com
              port: "5432"
              database: staging
              user: stg_user
              password: env:PG_ID_002__PASSWORD
        "
      `)
    })

    it('reports no changes when user keeps all defaults', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      await writeFile(filePath, EXISTING_YAML)

      const { context, pressEnter, tick } = await createPromptContext()

      const promise = editIntegration({ file: filePath, envFile: envFilePath }, context)
      await tick()

      // Select first integration
      pressEnter()
      await tick()

      // Keep all defaults
      pressEnter() // name
      await tick()
      pressEnter() // host
      await tick()
      pressEnter() // port
      await tick()
      pressEnter() // database
      await tick()
      pressEnter() // user
      await tick()
      pressEnter() // password (empty = keep)

      await promise

      // File should remain unchanged
      const yamlContent = await readFile(filePath, 'utf-8')
      expect(yamlContent).toMatchInlineSnapshot(`
        "#yaml-language-server: $schema=https://example.com/schema.json

        integrations:
          - id: pg-id-001
            name: Production DB
            type: pgsql
            federated_auth_method: null
            metadata:
              host: prod.example.com
              port: "5432"
              database: production
              user: admin
              password: env:PG_ID_001__PASSWORD
          - id: pg-id-002
            name: Staging DB
            type: pgsql
            federated_auth_method: null
            metadata:
              host: staging.example.com
              port: "5432"
              database: staging
              user: stg_user
              password: env:PG_ID_002__PASSWORD
        "
      `)
    })

    it('password field does not show in plaintext in terminal output', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      await writeFile(filePath, EXISTING_YAML)

      const { context, typeAndEnter, pressEnter, tick, outputStream } = await createPromptContext()

      let allOutput = ''
      outputStream.on('data', (chunk: Buffer) => {
        allOutput += chunk.toString('utf-8')
      })

      const promise = editIntegration({ file: filePath, envFile: envFilePath }, context)
      await tick()

      pressEnter() // select
      await tick()
      pressEnter() // name
      await tick()
      pressEnter() // host
      await tick()
      pressEnter() // port
      await tick()
      pressEnter() // database
      await tick()
      pressEnter() // user
      await tick()
      typeAndEnter('topsecret')
      await tick()

      await promise

      const { stripVTControlCharacters } = await import('node:util')
      const stripped = stripVTControlCharacters(allOutput)
      expect(stripped).not.toContain('topsecret')
    })

    it('preserves schema comment in YAML file', async () => {
      const filePath = join(tempDir, 'integrations.yaml')
      const envFilePath = join(tempDir, '.env')

      await writeFile(filePath, EXISTING_YAML)

      const { context, typeText, typeAndEnter, pressEnter, tick } = await createPromptContext()

      const promise = editIntegration({ file: filePath, envFile: envFilePath }, context)
      await tick()

      pressEnter() // select
      await tick()
      typeText('\x15')
      typeAndEnter('Renamed') // name
      await tick()
      pressEnter() // host
      await tick()
      pressEnter() // port
      await tick()
      pressEnter() // database
      await tick()
      pressEnter() // user
      await tick()
      pressEnter() // password

      await promise

      const yamlContent = await readFile(filePath, 'utf-8')
      expect(yamlContent).toMatchInlineSnapshot(`
        "#yaml-language-server: $schema=https://example.com/schema.json

        integrations:
          - id: pg-id-001
            name: Renamed
            type: pgsql
            federated_auth_method: null
            metadata:
              host: prod.example.com
              port: "5432"
              database: production
              user: admin
              password: env:PG_ID_001__PASSWORD
          - id: pg-id-002
            name: Staging DB
            type: pgsql
            federated_auth_method: null
            metadata:
              host: staging.example.com
              port: "5432"
              database: staging
              user: stg_user
              password: env:PG_ID_002__PASSWORD
        "
      `)
    })
  })
})
