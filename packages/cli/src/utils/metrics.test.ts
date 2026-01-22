import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { resetOutputConfig } from '../output'
import { createProgressBar, displayMetrics, fetchMetrics, formatBytes, type JupyterMetricsResponse } from './metrics'

function getOutput(spy: Mock): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n')
}

describe('metrics utilities', () => {
  describe('formatBytes', () => {
    it('formats small values as MB', () => {
      expect(formatBytes(104857600)).toBe('100MB') // 100MB
      expect(formatBytes(52428800)).toBe('50MB') // 50MB
      expect(formatBytes(1048576)).toBe('1MB') // 1MB
    })

    it('formats large values as GB', () => {
      expect(formatBytes(1073741824)).toBe('1.0GB') // 1GB
      expect(formatBytes(2147483648)).toBe('2.0GB') // 2GB
      expect(formatBytes(5368709120)).toBe('5.0GB') // 5GB
    })

    it('formats values just under 1GB as MB', () => {
      expect(formatBytes(1073741823)).toBe('1024MB') // Just under 1GB
    })

    it('formats fractional GB values', () => {
      expect(formatBytes(1610612736)).toBe('1.5GB') // 1.5GB
      expect(formatBytes(2684354560)).toBe('2.5GB') // 2.5GB
    })
  })

  describe('createProgressBar', () => {
    it('creates empty bar for 0%', () => {
      const bar = createProgressBar(0, 10)
      expect(bar).toContain('░'.repeat(10))
      expect(bar).not.toContain('█')
    })

    it('creates full bar for 100%', () => {
      const bar = createProgressBar(100, 10)
      expect(bar).toContain('█'.repeat(10))
    })

    it('creates half-filled bar for 50%', () => {
      const bar = createProgressBar(50, 10)
      expect(bar).toContain('█'.repeat(5))
      expect(bar).toContain('░'.repeat(5))
    })

    it('rounds to nearest filled block', () => {
      // 25% of 10 = 2.5, rounds to 3
      const bar = createProgressBar(25, 10)
      expect(bar).toContain('█'.repeat(3))
      expect(bar).toContain('░'.repeat(7))
    })

    it('creates bar with correct structure for various percentages', () => {
      // Low usage
      const lowBar = createProgressBar(30, 10)
      expect(lowBar).toContain('[')
      expect(lowBar).toContain(']')

      // Medium usage
      const medBar = createProgressBar(70, 10)
      expect(medBar).toContain('[')
      expect(medBar).toContain(']')

      // High usage
      const highBar = createProgressBar(90, 10)
      expect(highBar).toContain('[')
      expect(highBar).toContain(']')
    })
  })

  describe('fetchMetrics', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('fetches metrics from correct URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            rss: 100000000,
            limits: { memory: { rss: 0 } },
            cpu_percent: 25,
            cpu_count: 4,
          }),
      })
      vi.stubGlobal('fetch', mockFetch)

      await fetchMetrics(8888)

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:8888/api/metrics/v1')
    })

    it('returns metrics on success', async () => {
      const expectedMetrics = {
        rss: 100000000,
        limits: { memory: { rss: 200000000 } },
        cpu_percent: 25.5,
        cpu_count: 8,
      }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(expectedMetrics),
        })
      )

      const result = await fetchMetrics(8888)

      expect(result).toEqual(expectedMetrics)
    })

    it('returns null on non-ok response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
        })
      )

      const result = await fetchMetrics(8888)

      expect(result).toBeNull()
    })

    it('returns null on fetch error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')))

      const result = await fetchMetrics(8888)

      expect(result).toBeNull()
    })

    it('uses custom port', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ rss: 0, limits: { memory: { rss: 0 } }, cpu_percent: 0, cpu_count: 1 }),
      })
      vi.stubGlobal('fetch', mockFetch)

      await fetchMetrics(9000)

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:9000/api/metrics/v1')
    })
  })

  describe('displayMetrics', () => {
    let consoleSpy: Mock

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      resetOutputConfig()
    })

    afterEach(() => {
      consoleSpy.mockRestore()
    })

    it('displays CPU and memory', () => {
      const metrics: JupyterMetricsResponse = {
        rss: 104857600, // 100MB
        limits: { memory: { rss: 0 } },
        cpu_percent: 25.5,
        cpu_count: 4,
      }

      displayMetrics(metrics)

      const output = getOutput(consoleSpy)
      expect(output).toContain('CPU:')
      expect(output).toContain('25.5%')
      expect(output).toContain('Memory:')
      expect(output).toContain('100MB')
    })

    it('displays memory with limit when set', () => {
      const metrics: JupyterMetricsResponse = {
        rss: 536870912, // 512MB
        limits: { memory: { rss: 1073741824 } }, // 1GB limit
        cpu_percent: 50,
        cpu_count: 4,
      }

      displayMetrics(metrics)

      const output = getOutput(consoleSpy)
      expect(output).toContain('512MB')
      expect(output).toContain('1.0GB')
    })

    it('displays only used memory when no limit', () => {
      const metrics: JupyterMetricsResponse = {
        rss: 209715200, // 200MB
        limits: { memory: { rss: 0 } }, // No limit
        cpu_percent: 10,
        cpu_count: 2,
      }

      displayMetrics(metrics)

      const output = getOutput(consoleSpy)
      expect(output).toContain('200MB')
      // Should not contain a second memory value (no limit display)
      expect(output.match(/\d+MB/g)?.length).toBe(1)
    })
  })
})
