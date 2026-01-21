import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  debug,
  error,
  getChalk,
  getOutputConfig,
  log,
  outputJson,
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
})
