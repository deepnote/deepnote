import { describe, expect, it } from 'vitest'
import type { ApiIntegration } from './fetch-integrations'
import { IntegrationsYamlParseError } from './integrations-document'
import { InvalidIntegrationsTypeError } from './merge-integrations'
import { type IntegrationsYamlDocumentMergeResult, mergeApiIntegrationsIntoYaml } from './merge-into-yaml'

// Helper to create a mock API integration
function createMockApiIntegration(overrides: Partial<ApiIntegration> = {}): ApiIntegration {
  return {
    id: 'test-id',
    name: 'Test Integration',
    type: 'pgsql',
    metadata: {
      host: 'localhost',
      port: '5432',
      database: 'test-database',
      user: 'test-user',
      password: 'test-password',
    },
    is_public: false,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    federated_auth_method: null,
    ...overrides,
  }
}

// Reproduction from issue #424: an integrations file left with unresolved git merge
// conflict markers. This used to reach serialization and fail with the opaque
// "Document with errors cannot be stringified".
const CONFLICT_MARKERS_YAML = [
  'integrations:',
  '<<<<<<< HEAD',
  '  - id: a',
  '=======',
  '  - id: b',
  '>>>>>>> branch',
  '',
].join('\n')

// The other repro from the issue: a plain hand-edit typo.
const TYPO_YAML = 'a: b: c\n'

const EXISTING_WITH_COMMENTS = `# Databases used by the nightly ETL job
integrations:
  # Keep this one - it is not in the workspace
  - id: local-only
    name: Local Only DB
    type: mysql
    metadata:
      host: localhost # dev machine only
      port: "3306"
  - id: test-id
    name: Old Name
    type: pgsql
    metadata:
      host: old-host
      password: env:MY_CUSTOM_PASSWORD
`

describe('mergeApiIntegrationsIntoYaml', () => {
  it('creates a fresh document when there is no existing content', () => {
    const { content, secrets, stats, skipped } = mergeApiIntegrationsIntoYaml(null, [createMockApiIntegration()])

    expect(content).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

      integrations:
        - id: test-id
          name: Test Integration
          type: pgsql
          federated_auth_method: null
          metadata:
            host: localhost
            user: test-user
            password: env:TEST_ID__PASSWORD
            database: test-database
            port: "5432"
      "
    `)
    expect(secrets).toEqual({ 'TEST_ID__PASSWORD': 'test-password' })
    expect(stats).toEqual({ existingCount: 0, newCount: 1, updatedCount: 0 })
    expect(skipped).toEqual([])
  })

  it('treats empty existing content the same as no content', () => {
    const fromNull = mergeApiIntegrationsIntoYaml(null, [createMockApiIntegration()])
    const fromEmpty = mergeApiIntegrationsIntoYaml('', [createMockApiIntegration()])

    expect(fromEmpty.content).toEqual(fromNull.content)
    expect(fromEmpty.secrets).toEqual(fromNull.secrets)
  })

  it('merges into existing content, preserving comments, local-only entries and custom env var names', () => {
    const { content, secrets, stats } = mergeApiIntegrationsIntoYaml(EXISTING_WITH_COMMENTS, [
      createMockApiIntegration(),
    ])

    expect(content).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

      # Databases used by the nightly ETL job
      integrations:
        # Keep this one - it is not in the workspace
        - id: local-only
          name: Local Only DB
          type: mysql
          metadata:
            host: localhost # dev machine only
            port: "3306"
        - id: test-id
          name: Test Integration
          type: pgsql
          metadata:
            host: localhost
            password: env:MY_CUSTOM_PASSWORD
            user: test-user
            database: test-database
            port: "5432"
          federated_auth_method: null
      "
    `)
    expect(secrets).toEqual({ 'MY_CUSTOM_PASSWORD': 'test-password' })
    expect(stats).toEqual({ existingCount: 2, newCount: 0, updatedCount: 1 })
  })

  it('throws IntegrationsYamlParseError for unresolved merge conflict markers', () => {
    expect(() => mergeApiIntegrationsIntoYaml(CONFLICT_MARKERS_YAML, [createMockApiIntegration()])).toThrow(
      IntegrationsYamlParseError
    )
  })

  it('throws IntegrationsYamlParseError for a manual-edit typo', () => {
    expect(() => mergeApiIntegrationsIntoYaml(TYPO_YAML, [createMockApiIntegration()])).toThrow(
      IntegrationsYamlParseError
    )
  })

  it('fails at parse time rather than at serialization time', () => {
    try {
      mergeApiIntegrationsIntoYaml(CONFLICT_MARKERS_YAML, [createMockApiIntegration()])
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(IntegrationsYamlParseError)

      const parseError = error as IntegrationsYamlParseError
      expect(parseError.errors.length).toBeGreaterThan(0)
      expect(parseError.message).toMatch(/at line \d+, column \d+/)
      // The pre-fix failure mode, which said nothing about where the file was broken.
      expect(parseError.message).not.toContain('Document with errors cannot be stringified')
    }
  })

  it('parses before merging, regardless of the API list', () => {
    expect(() => mergeApiIntegrationsIntoYaml(CONFLICT_MARKERS_YAML, [])).toThrow(IntegrationsYamlParseError)
  })

  it('throws InvalidIntegrationsTypeError when integrations is not a list', () => {
    expect(() => mergeApiIntegrationsIntoYaml('integrations: "not a list"\n', [createMockApiIntegration()])).toThrow(
      InvalidIntegrationsTypeError
    )
  })

  it('supports rebuilding from scratch by re-running with null after a parse failure', () => {
    // The documented recovery recipe for consumers that would rather discard a
    // corrupt file than ask the user to fix it.
    function mergeRebuildingOnParseFailure(
      existingContent: string | null,
      apiIntegrations: ApiIntegration[]
    ): IntegrationsYamlDocumentMergeResult {
      try {
        return mergeApiIntegrationsIntoYaml(existingContent, apiIntegrations)
      } catch (error) {
        if (!(error instanceof IntegrationsYamlParseError)) {
          throw error
        }
        return mergeApiIntegrationsIntoYaml(null, apiIntegrations)
      }
    }

    const result = mergeRebuildingOnParseFailure(CONFLICT_MARKERS_YAML, [createMockApiIntegration()])

    expect(result.content).toMatchInlineSnapshot(`
      "#yaml-language-server: $schema=https://raw.githubusercontent.com/deepnote/deepnote/refs/heads/tk/integrations-config-file-schema/json-schemas/integrations-file-schema.json

      integrations:
        - id: test-id
          name: Test Integration
          type: pgsql
          federated_auth_method: null
          metadata:
            host: localhost
            user: test-user
            password: env:TEST_ID__PASSWORD
            database: test-database
            port: "5432"
      "
    `)
    expect(result.content).not.toContain('<<<<<<<')
    expect(result.secrets).toEqual({ 'TEST_ID__PASSWORD': 'test-password' })
  })
})
