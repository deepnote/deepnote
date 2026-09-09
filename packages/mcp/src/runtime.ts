import { ServerPool } from '@deepnote/runtime-core'

const DEFAULT_IDLE_SECONDS = 300

/**
 * Seconds a deepnote-toolkit server stays warm after the last run that used it. `0` stops the server
 * as soon as a run ends; unset or invalid values use the default of five minutes.
 */
export const SERVER_IDLE_ENV_VAR = 'DEEPNOTE_MCP_SERVER_IDLE_SECONDS'

export function readServerIdleTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env[SERVER_IDLE_ENV_VAR]
  if (raw === undefined || raw.trim() === '') return DEFAULT_IDLE_SECONDS * 1000
  const seconds = Number(raw)
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_IDLE_SECONDS * 1000
  return seconds * 1000
}

/**
 * Warm deepnote-toolkit servers shared by every run this MCP process performs. Each run still gets
 * its own fresh kernel, so state never leaks between tool calls; only the expensive server process
 * is reused.
 */
export const serverPool = new ServerPool({ idleTimeoutMs: readServerIdleTimeoutMs() })

let hooksRegistered = false

/**
 * Stops pooled servers when the MCP process ends, so no toolkit server outlives its host. Signals
 * shut the pool down gracefully; the `exit` hook is the synchronous last resort.
 */
export function registerRuntimeShutdownHooks(): void {
  if (hooksRegistered) return
  hooksRegistered = true

  const shutdownAndExit = (code: number) => {
    void serverPool.shutdown().finally(() => process.exit(code))
  }
  process.once('SIGINT', () => shutdownAndExit(130))
  process.once('SIGTERM', () => shutdownAndExit(143))
  process.on('exit', () => serverPool.killAll())
}

/** Stops every warm server. Called when the MCP transport closes. */
export async function shutdownRuntime(): Promise<void> {
  await serverPool.shutdown()
}
