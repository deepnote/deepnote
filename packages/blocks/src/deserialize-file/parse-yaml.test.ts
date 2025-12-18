import { describe, expect, it } from 'vitest'
import { parseYaml } from './parse-yaml'

describe('parseYaml', () => {
  describe('basic parsing', () => {
    it('parses a simple key-value YAML', () => {
      const yamlContent = `
      name: Deepnote
      version: 1.0
    `
      const result = parseYaml(yamlContent)

      expect(result).toEqual({ name: 'Deepnote', version: 1.0 })
    })

    it('parses nested YAML structures', () => {
      const yamlContent = `
      notebook:
        title: Test Notebook
        author:
          name: Alice
          team: AI
    `
      const result = parseYaml(yamlContent)

      expect(result).toEqual({
        notebook: {
          title: 'Test Notebook',
          author: { name: 'Alice', team: 'AI' },
        },
      })
    })

    it('parses YAML arrays', () => {
      const yamlContent = `
      items:
        - apple
        - banana
        - cherry
    `
      const result = parseYaml(yamlContent)

      expect(result).toEqual({ items: ['apple', 'banana', 'cherry'] })
    })

    it('parses a YAML list of objects', () => {
      const yamlContent = `
      users:
        - name: Alice
          role: admin
        - name: Bob
          role: user
    `
      const result = parseYaml(yamlContent)

      expect(result).toEqual({
        users: [
          { name: 'Alice', role: 'admin' },
          { name: 'Bob', role: 'user' },
        ],
      })
    })

    it('parses empty YAML as null', () => {
      const yamlContent = ''
      const result = parseYaml(yamlContent)
      expect(result).toBeNull()
    })

    it('throws an error for invalid YAML syntax', () => {
      const yamlContent = `
      name: Deepnote
        version: 1.0
      invalid:
    `
      expect(() => parseYaml(yamlContent)).toThrow(Error)
      expect(() => parseYaml(yamlContent)).toThrow(/Failed to parse Deepnote file/)
    })

    it('throws an error with custom message when given non-YAML input', () => {
      const yamlContent = 'not:valid:yaml:::'
      try {
        parseYaml(yamlContent)
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toMatch(/Failed to parse Deepnote file/)
      }
    })
  })

  describe('UTF-8 validation', () => {
    it('accepts valid UTF-8 content', () => {
      const yamlContent = `
      name: Deepnote 🚀
      emoji: 😀
      unicode: "日本語"
    `
      const result = parseYaml(yamlContent)
      expect(result).toEqual({
        name: 'Deepnote 🚀',
        emoji: '😀',
        unicode: '日本語',
      })
    })

    it('accepts ASCII content (subset of UTF-8)', () => {
      const yamlContent = 'name: Deepnote\nversion: 1.0'
      const result = parseYaml(yamlContent)
      expect(result).toEqual({ name: 'Deepnote', version: 1.0 })
    })
  })

  describe('duplicate key detection', () => {
    it('throws an error for duplicate keys at root level', () => {
      const yamlContent = `
      name: First
      version: 1.0
      name: Second
    `
      expect(() => parseYaml(yamlContent)).toThrow(/duplicate/i)
    })

    it('throws an error for duplicate keys in nested objects', () => {
      const yamlContent = `
      project:
        id: 123
        name: Test
        id: 456
    `
      expect(() => parseYaml(yamlContent)).toThrow(/duplicate/i)
    })

    it('allows same key names in different nested objects', () => {
      const yamlContent = `
      project1:
        id: 123
      project2:
        id: 456
    `
      const result = parseYaml(yamlContent)
      expect(result).toEqual({
        project1: { id: 123 },
        project2: { id: 456 },
      })
    })
  })

  describe('anchor and alias rejection', () => {
    it('throws an error for YAML anchors', () => {
      const yamlContent = `
      defaults: &defaults
        timeout: 30
      production:
        <<: *defaults
    `
      expect(() => parseYaml(yamlContent)).toThrow(/anchors.*not allowed/i)
    })

    it('throws an error for YAML aliases', () => {
      const yamlContent = `
      base: &base
        name: Test
      derived: *base
    `
      // Both anchor and alias are present, so either error is acceptable
      expect(() => parseYaml(yamlContent)).toThrow(/anchor|alias/i)
    })
  })

  describe('merge key rejection', () => {
    it('throws an error for merge keys', () => {
      const yamlContent = `
      base:
        x: 1
        y: 2
      extended:
        <<: base
        z: 3
    `
      expect(() => parseYaml(yamlContent)).toThrow(/merge keys.*not allowed/i)
    })
  })

  describe('custom tag rejection', () => {
    it('throws an error for custom tags', () => {
      const yamlContent = `
      value: !custom some value
    `
      expect(() => parseYaml(yamlContent)).toThrow(/tags.*not allowed/i)
    })

    it('throws an error for Python-specific tags', () => {
      const yamlContent = `
      date: !python/object/apply:datetime.date [2024, 1, 1]
    `
      expect(() => parseYaml(yamlContent)).toThrow(/tags.*not allowed/i)
    })

    it('throws an error for explicit type tags', () => {
      const yamlContent = `
      string: !str "123"
    `
      expect(() => parseYaml(yamlContent)).toThrow(/tags.*not allowed/i)
    })
  })

  describe('explicit typing requirements', () => {
    it('parses ISO 8601 timestamps as strings', () => {
      const yamlContent = `
      createdAt: "2024-01-15T10:30:00Z"
      modifiedAt: "2024-01-15T11:45:00+01:00"
    `
      const result = parseYaml(yamlContent)
      expect(result).toEqual({
        createdAt: '2024-01-15T10:30:00Z',
        modifiedAt: '2024-01-15T11:45:00+01:00',
      })
      expect(typeof (result as Record<string, unknown>).createdAt).toBe('string')
      expect(typeof (result as Record<string, unknown>).modifiedAt).toBe('string')
    })

    it('handles boolean values correctly (YAML 1.2 only true/false)', () => {
      const yamlContent = `
      enabled: true
      disabled: false
    `
      const result = parseYaml(yamlContent)
      expect(result).toEqual({
        enabled: true,
        disabled: false,
      })
    })

    it('treats yes/no as strings in YAML 1.2', () => {
      const yamlContent = `
      yes_value: yes
      no_value: no
      on_value: on
      off_value: off
    `
      const result = parseYaml(yamlContent)
      // In YAML 1.2, yes/no/on/off are strings, not booleans
      expect(result).toEqual({
        yes_value: 'yes',
        no_value: 'no',
        on_value: 'on',
        off_value: 'off',
      })
    })

    it('handles null values correctly', () => {
      const yamlContent = `
      value1: null
      value2: ~
    `
      const result = parseYaml(yamlContent)
      expect(result).toEqual({
        value1: null,
        value2: null,
      })
    })

    it('handles numeric values correctly', () => {
      const yamlContent = `
      integer: 42
      float: 3.14
      negative: -10
      scientific: 1.23e+10
    `
      const result = parseYaml(yamlContent)
      expect(result).toEqual({
        integer: 42,
        float: 3.14,
        negative: -10,
        scientific: 1.23e10,
      })
    })
  })
})
