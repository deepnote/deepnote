import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  debug,
  error,
  getChalk,
  getOutputConfig,
  log,
  output,
  outputJson,
  outputToon,
  resetOutputConfig,
  setOutputConfig,
  shouldDisableColor,
} from './output'

describe('output', () => {
  let originalNoColor: string | undefined
  let originalForceColor: string | undefined

  beforeEach(() => {
    originalNoColor = process.env.NO_COLOR
    originalForceColor = process.env.FORCE_COLOR
    resetOutputConfig()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    resetOutputConfig()
    // Restore original env vars
    if (originalNoColor === undefined) delete process.env.NO_COLOR
    else process.env.NO_COLOR = originalNoColor
    if (originalForceColor === undefined) delete process.env.FORCE_COLOR
    else process.env.FORCE_COLOR = originalForceColor
  })

  describe('getOutputConfig', () => {
    it('returns default config initially', () => {
      const config = getOutputConfig()
      expect(config).toEqual({
        color: true,
        debug: false,
        quiet: false,
      })
    })

    it('returns config that does not mutate internal state', () => {
      const config = getOutputConfig()
      // Attempt to mutate should not affect internal state
      ;(config as { debug: boolean }).debug = true
      expect(getOutputConfig().debug).toBe(false)
    })
  })

  describe('setOutputConfig', () => {
    it('updates partial config', () => {
      setOutputConfig({ debug: true })
      expect(getOutputConfig().debug).toBe(true)
      expect(getOutputConfig().color).toBe(true) // unchanged
    })

    it('updates multiple options', () => {
      setOutputConfig({ debug: true, quiet: true })
      expect(getOutputConfig().debug).toBe(true)
      expect(getOutputConfig().quiet).toBe(true)
    })

    it('disables chalk when color is false', () => {
      setOutputConfig({ color: false })
      expect(getOutputConfig().color).toBe(false)
      // Verify chalk actually produces uncolored output
      const chalk = getChalk()
      expect(chalk.red('text')).toBe('text')
    })
  })

  describe('resetOutputConfig', () => {
    it('resets to defaults', () => {
      setOutputConfig({ debug: true, quiet: true, color: false })
      resetOutputConfig()
      expect(getOutputConfig()).toEqual({
        color: true,
        debug: false,
        quiet: false,
      })
    })
  })

  describe('shouldDisableColor', () => {
    const originalIsTTY = process.stdout.isTTY

    afterEach(() => {
      // Restore TTY state
      Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true })
    })

    it('returns false when FORCE_COLOR=1', () => {
      process.env.FORCE_COLOR = '1'
      expect(shouldDisableColor()).toBe(false)
    })

    it('returns true when FORCE_COLOR=0', () => {
      process.env.FORCE_COLOR = '0'
      expect(shouldDisableColor()).toBe(true)
    })

    it('returns true when NO_COLOR is set', () => {
      delete process.env.FORCE_COLOR
      process.env.NO_COLOR = '1'
      expect(shouldDisableColor()).toBe(true)
    })

    it('returns true when NO_COLOR is empty string', () => {
      delete process.env.FORCE_COLOR
      process.env.NO_COLOR = ''
      expect(shouldDisableColor()).toBe(true)
    })

    it('returns true when not a TTY', () => {
      delete process.env.FORCE_COLOR
      delete process.env.NO_COLOR
      Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true })
      expect(shouldDisableColor()).toBe(true)
    })

    it('returns false when TTY and no env vars', () => {
      delete process.env.FORCE_COLOR
      delete process.env.NO_COLOR
      Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true })
      expect(shouldDisableColor()).toBe(false)
    })

    it('FORCE_COLOR takes precedence over NO_COLOR', () => {
      process.env.FORCE_COLOR = '1'
      process.env.NO_COLOR = '1'
      expect(shouldDisableColor()).toBe(false)
    })
  })

  describe('getChalk', () => {
    it('returns chalk instance', () => {
      const chalkInstance = getChalk()
      expect(chalkInstance).toBeDefined()
      expect(typeof chalkInstance.red).toBe('function')
    })
  })

  describe('output', () => {
    it('outputs message to stdout', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      output('test message')
      expect(consoleSpy).toHaveBeenCalledWith('test message')
    })

    it('outputs even when quiet (essential output)', () => {
      setOutputConfig({ quiet: true })
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      output('test message')
      expect(consoleSpy).toHaveBeenCalledWith('test message')
    })
  })

  describe('log', () => {
    it('logs message when not quiet', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      log('test message')
      expect(consoleSpy).toHaveBeenCalledWith('test message')
    })

    it('does not log when quiet', () => {
      setOutputConfig({ quiet: true })
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      log('test message')
      expect(consoleSpy).not.toHaveBeenCalled()
    })
  })

  describe('debug', () => {
    it('does not log when debug is false', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      debug('test message')
      expect(consoleSpy).not.toHaveBeenCalled()
    })

    it('logs to stderr when debug is true', () => {
      setOutputConfig({ debug: true })
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      debug('test message')
      expect(consoleSpy).toHaveBeenCalled()
      expect(consoleSpy.mock.calls[0][0]).toContain('[debug]')
      expect(consoleSpy.mock.calls[0][0]).toContain('test message')
    })

    it('does not log when quiet even if debug is true', () => {
      setOutputConfig({ debug: true, quiet: true })
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      debug('test message')
      expect(consoleSpy).not.toHaveBeenCalled()
    })
  })

  describe('error', () => {
    it('logs error message to stderr', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      error('error message')
      expect(consoleSpy).toHaveBeenCalled()
    })

    it('logs even when quiet', () => {
      setOutputConfig({ quiet: true })
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      error('error message')
      expect(consoleSpy).toHaveBeenCalled()
    })
  })

  describe('outputJson', () => {
    it('outputs JSON to console.log', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      outputJson({ key: 'value' })
      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({ key: 'value' }, null, 2))
    })

    it('handles complex objects', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const data = { nested: { array: [1, 2, 3] }, string: 'test' }
      outputJson(data)
      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(data, null, 2))
    })
  })

  describe('outputToon', () => {
    it('outputs TOON format to console.log', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      outputToon({ key: 'value' })
      expect(consoleSpy).toHaveBeenCalledWith('key: value')
    })

    it('handles nested objects with indentation', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      outputToon({ outer: { inner: 'test' } })
      expect(consoleSpy).toHaveBeenCalledWith('outer:\n  inner: test')
    })

    it('handles arrays of uniform objects in tabular format', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const data = {
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
      }
      outputToon(data)
      const output = consoleSpy.mock.calls[0][0]
      // TOON uses tabular format for uniform arrays
      expect(output).toContain('users[2]')
      expect(output).toContain('id')
      expect(output).toContain('name')
      expect(output).toContain('Alice')
      expect(output).toContain('Bob')
    })

    it('handles simple arrays', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      outputToon({ items: ['a', 'b', 'c'] })
      const output = consoleSpy.mock.calls[0][0]
      expect(output).toContain('items[3]')
      expect(output).toContain('a')
      expect(output).toContain('b')
      expect(output).toContain('c')
    })

    it('handles booleans and numbers', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      outputToon({ active: true, count: 42, rate: 3.14 })
      const output = consoleSpy.mock.calls[0][0]
      expect(output).toContain('active: true')
      expect(output).toContain('count: 42')
      expect(output).toContain('rate: 3.14')
    })

    it('shows efficiency hint when TOON provides minimal savings', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Raw primitive - TOON provides 0% savings over JSON
      outputToon(42, { showEfficiencyHint: true })

      expect(logSpy).toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalled()
      expect(errorSpy.mock.calls[0][0]).toContain('Hint:')
    })

    it('shows JSON-is-smaller hint when TOON is less efficient', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Empty array - TOON is actually larger than JSON
      outputToon([], { showEfficiencyHint: true })

      expect(logSpy).toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalled()
      // Should show the "JSON would be smaller" hint
      expect(errorSpy.mock.calls[0][0]).toContain('JSON would be')
      expect(errorSpy.mock.calls[0][0]).toContain('smaller')
    })

    it('does not show hint when TOON is efficient', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Uniform array of objects - TOON excels here
      const data = {
        users: Array.from({ length: 10 }, (_, i) => ({
          id: i,
          name: `User ${i}`,
          email: `user${i}@example.com`,
          active: true,
        })),
      }
      outputToon(data, { showEfficiencyHint: true })

      expect(logSpy).toHaveBeenCalled()
      expect(errorSpy).not.toHaveBeenCalled()
    })

    it('does not show hint when showEfficiencyHint is false', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      outputToon({ key: 'value' }, { showEfficiencyHint: false })

      expect(logSpy).toHaveBeenCalled()
      expect(errorSpy).not.toHaveBeenCalled()
    })

    it('does not show hint in quiet mode', () => {
      setOutputConfig({ quiet: true })
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      outputToon({ key: 'value' }, { showEfficiencyHint: true })

      expect(logSpy).toHaveBeenCalled()
      expect(errorSpy).not.toHaveBeenCalled()
    })

    it('handles strings with newlines', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      outputToon({ note: 'line1\nline2' })
      const output = consoleSpy.mock.calls[0][0]
      expect(output).toContain('note')
      expect(output).toContain('line1')
      expect(output).toContain('line2')
    })

    it('handles strings with double quotes', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      outputToon({ quote: '"in quotes"' })
      const output = consoleSpy.mock.calls[0][0]
      expect(output).toContain('quote')
      // TOON escapes double quotes within strings
      expect(output).toContain('in quotes')
    })

    it('handles strings with single quotes', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      outputToon({ text: "it's fine" })
      const output = consoleSpy.mock.calls[0][0]
      expect(output).toContain('text')
      expect(output).toContain("it's fine")
    })

    it('handles strings with colons', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      outputToon({ colon: 'a: b' })
      const output = consoleSpy.mock.calls[0][0]
      expect(output).toContain('colon')
      expect(output).toContain('a: b')
    })

    it('handles strings with backslashes', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      outputToon({ back: '\\path\\to\\file' })
      const output = consoleSpy.mock.calls[0][0]
      expect(output).toContain('back')
      expect(output).toContain('\\path')
    })

    it('handles empty arrays', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      outputToon({ items: [] })
      const output = consoleSpy.mock.calls[0][0]
      expect(output).toContain('items[0]')
    })

    it('handles null values', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      outputToon({ missing: null })
      const output = consoleSpy.mock.calls[0][0]
      expect(output).toContain('missing')
      expect(output).toContain('null')
    })

    it('handles mixed special characters', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      outputToon({
        note: 'line1\nline2',
        quote: '"in quotes"',
        colon: 'a: b',
        back: '\\path',
        items: [],
        missing: null,
      })
      const output = consoleSpy.mock.calls[0][0]
      expect(output).toContain('note')
      expect(output).toContain('quote')
      expect(output).toContain('colon')
      expect(output).toContain('back')
      expect(output).toContain('items[0]')
      expect(output).toContain('missing')
      expect(output).toContain('null')
    })
  })
})
