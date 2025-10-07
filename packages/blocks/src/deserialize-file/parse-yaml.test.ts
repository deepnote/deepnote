import { describe, expect, it } from 'vitest'
import { parseYaml } from './parse-yaml'

describe('parseYaml', () => {
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
