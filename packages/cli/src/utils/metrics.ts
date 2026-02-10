import { z } from 'zod'
import { debug, getChalk, output } from '../output'

/** Schema for jupyter_resource_usage API response */
export const JupyterMetricsResponseSchema = z.object({
  rss: z.number(), // Memory used in bytes
  limits: z.object({
    memory: z.object({
      rss: z.number(), // Memory limit in bytes (0 = no limit)
    }),
  }),
  cpu_percent: z.number(),
  cpu_count: z.number(),
})

/** Raw response from jupyter_resource_usage API */
export type JupyterMetricsResponse = z.infer<typeof JupyterMetricsResponseSchema>

/** Profile data for a single block */
export interface BlockProfile {
  id: string
  label: string
  durationMs: number
  memoryBefore: number
  memoryAfter: number
  memoryDelta: number
}

/** Default timeout for metrics fetch in milliseconds */
const METRICS_FETCH_TIMEOUT_MS = 5000

/** Fetch resource metrics from the Jupyter server */
export async function fetchMetrics(
  port: number,
  timeoutMs: number = METRICS_FETCH_TIMEOUT_MS
): Promise<JupyterMetricsResponse | null> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(`http://localhost:${port}/api/metrics/v1`, {
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!response.ok) return null
    const json = await response.json()
    const result = JupyterMetricsResponseSchema.safeParse(json)
    if (!result.success) {
      debug(`Schema validation failed: ${result.error.message}`)
      return null
    }
    return result.data
  } catch (error) {
    clearTimeout(timeoutId)
    debug(`Failed to fetch metrics: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/** Format bytes as human-readable string */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)}GB`
  }
  return `${mb.toFixed(0)}MB`
}

/** Create a progress bar */
export function createProgressBar(percent: number, width: number): string {
  const c = getChalk()
  const p = Math.min(100, Math.max(0, percent))
  const filled = Math.round((p / 100) * width)
  const empty = Math.max(0, width - filled)

  let barColor = c.green
  if (p >= 80) {
    barColor = c.red
  } else if (p >= 60) {
    barColor = c.yellow
  }

  return `[${barColor('█'.repeat(filled))}${c.dim('░'.repeat(empty))}]`
}

/** Display resource metrics inline */
export function displayMetrics(metrics: JupyterMetricsResponse): void {
  const c = getChalk()
  const cpuBar = createProgressBar(metrics.cpu_percent, 15)
  const memUsed = formatBytes(metrics.rss)

  let memDisplay: string
  if (metrics.limits.memory.rss > 0) {
    const memLimit = formatBytes(metrics.limits.memory.rss)
    const memPercent = (metrics.rss / metrics.limits.memory.rss) * 100
    const memBar = createProgressBar(memPercent, 15)
    memDisplay = `${memBar} ${memUsed}/${memLimit}`
  } else {
    memDisplay = memUsed
  }

  output(c.dim(`  CPU: ${cpuBar} ${metrics.cpu_percent.toFixed(1)}% | Memory: ${memDisplay}`))
}

/** Format memory delta as human-readable string with sign */
export function formatMemoryDelta(bytes: number): string {
  const sign = bytes >= 0 ? '+' : ''
  const mb = bytes / (1024 * 1024)
  if (Math.abs(mb) >= 1024) {
    return `${sign}${(mb / 1024).toFixed(1)}GB`
  }
  return `${sign}${mb.toFixed(0)}MB`
}

/** Display profile summary table */
export function displayProfileSummary(profiles: BlockProfile[]): void {
  if (profiles.length === 0) return

  const c = getChalk()

  // Sort by duration descending (slowest first)
  const sorted = [...profiles].sort((a, b) => b.durationMs - a.durationMs)

  // Calculate totals
  const totalDuration = profiles.reduce((sum, p) => sum + p.durationMs, 0)
  const totalMemoryDelta = profiles.reduce((sum, p) => sum + p.memoryDelta, 0)

  // Calculate column widths
  const labelWidth = Math.max(5, ...sorted.map(p => p.label.length))
  const durationWidth = Math.max(8, `${totalDuration}ms`.length)
  const memoryWidth = Math.max(
    6,
    formatMemoryDelta(totalMemoryDelta).length,
    ...sorted.map(p => formatMemoryDelta(p.memoryDelta).length)
  )

  output(c.bold('\nProfile Summary:'))

  // Header
  output(
    c.dim(`  ${'Block'.padEnd(labelWidth)}  ${'Duration'.padStart(durationWidth)}  ${'Memory'.padStart(memoryWidth)}`)
  )

  // Rows sorted by duration
  for (const profile of sorted) {
    const duration = `${profile.durationMs}ms`
    const memory = formatMemoryDelta(profile.memoryDelta)
    const memColor = profile.memoryDelta > 0 ? c.yellow : c.green

    output(
      `  ${profile.label.padEnd(labelWidth)}  ${c.cyan(duration.padStart(durationWidth))}  ${memColor(memory.padStart(memoryWidth))}`
    )
  }

  // Separator and totals
  const totalWidth = labelWidth + durationWidth + memoryWidth + 6
  output(c.dim(`  ${'─'.repeat(totalWidth)}`))

  const totalDurationStr = `${totalDuration}ms`
  const totalMemoryStr = formatMemoryDelta(totalMemoryDelta)
  const totalMemColor = totalMemoryDelta > 0 ? c.yellow : c.green

  output(
    `  ${'Total'.padEnd(labelWidth)}  ${c.cyan(totalDurationStr.padStart(durationWidth))}  ${totalMemColor(totalMemoryStr.padStart(memoryWidth))}`
  )
}
