import { describe, expect, it } from 'vitest'
import { isDocument, YAMLError } from 'yaml'
import {
  IntegrationsYamlParseError,
  parseIntegrationsDocument,
  serializeIntegrationsDocument,
} from './integrations-document'

// Reproduction from issue #424: an integrations file left with unresolved git merge
// conflict markers. `yaml` collects parse errors on the returned Document instead of
// throwing, so this used to surface much later as the opaque
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

const VALID_YAML = `integrations:
  - id: pg-id-001
    name: Production DB
    type: pgsql
    metadata:
      host: prod.example.com
      port: "5432"
`

describe('integrations-document', () => {
  describe('parseIntegrationsDocument', () => {
    it('returns null for empty content', () => {
      expect(parseIntegrationsDocument('')).toBeNull()
    })

    it('returns null for whitespace-only content', () => {
      expect(parseIntegrationsDocument('  \n\n\t')).toBeNull()
    })

    it('returns a Document for valid content', () => {
      const doc = parseIntegrationsDocument(VALID_YAML)

      expect(isDocument(doc)).toBe(true)
    })

    it('round-trips valid content through serializeIntegrationsDocument', () => {
      const doc = parseIntegrationsDocument(VALID_YAML)
      if (!doc) throw new Error('Expected document to exist')

      expect(serializeIntegrationsDocument(doc)).toEqual(VALID_YAML)
    })

    it('throws IntegrationsYamlParseError for unresolved merge conflict markers', () => {
      expect(() => parseIntegrationsDocument(CONFLICT_MARKERS_YAML)).toThrow(IntegrationsYamlParseError)
    })

    it('throws IntegrationsYamlParseError for a manual-edit typo', () => {
      expect(() => parseIntegrationsDocument(TYPO_YAML)).toThrow(IntegrationsYamlParseError)
    })

    it('exposes the underlying yaml errors and the failing location', () => {
      try {
        parseIntegrationsDocument(CONFLICT_MARKERS_YAML)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(IntegrationsYamlParseError)

        const parseError = error as IntegrationsYamlParseError
        expect(parseError.name).toBe('IntegrationsYamlParseError')
        // How many errors `yaml` reports for a given fixture is its own business;
        // only that it reported some, and that they can be inspected, matters here.
        expect(parseError.errors.length).toBeGreaterThan(0)
        expect(parseError.errors[0]).toBeInstanceOf(YAMLError)
        // The message must carry enough for a user to find the broken line.
        expect(parseError.message).toMatch(/at line \d+, column \d+/)
      }
    })
  })
})
