import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { OrchestrationGraph, OrchestrationResult, OrchestrationStepResult } from './orchestrate'

const PERSISTENCE_SCHEMA_VERSION = 1

export interface NotebookCheckpoint {
  kind: 'notebook'
  fingerprint: string
  result: OrchestrationStepResult
}

export interface ControlCheckpoint {
  kind: 'control'
  fingerprint: string
  value?: unknown
  valueIsUndefined?: boolean
}

export type OrchestrationCheckpoint = NotebookCheckpoint | ControlCheckpoint

export interface PersistedOrchestrationState {
  schemaVersion: typeof PERSISTENCE_SCHEMA_VERSION
  status: 'running' | 'completed' | 'failed'
  startedAt: string
  updatedAt: string
  checkpoints: Record<string, OrchestrationCheckpoint>
  graph: OrchestrationGraph
  result?: OrchestrationResult<unknown>
  error?: string
}

export function newPersistedState(startedAt: string, graph: OrchestrationGraph): PersistedOrchestrationState {
  return {
    schemaVersion: PERSISTENCE_SCHEMA_VERSION,
    status: 'running',
    startedAt,
    updatedAt: startedAt,
    checkpoints: {},
    graph,
  }
}

export async function readPersistedState(file: string): Promise<PersistedOrchestrationState | null> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Cannot resume orchestration from "${file}": the state file is not valid JSON.`, {
      cause: error,
    })
  }

  if (!isPersistedState(parsed)) {
    throw new Error(
      `Cannot resume orchestration from "${file}": expected persistence schema ${PERSISTENCE_SCHEMA_VERSION}.`
    )
  }
  return parsed
}

export async function writePersistedState(file: string, state: PersistedOrchestrationState): Promise<void> {
  const parent = dirname(file)
  await mkdir(parent, { recursive: true })
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  const serialized = `${JSON.stringify(state, null, 2)}\n`
  await writeFile(temporary, serialized, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, file)
}

export function orchestrationFingerprint(value: unknown): string {
  return createHash('sha256').update(stableSerialize(value)).digest('hex')
}

export function assertJsonSerializable(value: unknown, description: string): void {
  try {
    JSON.stringify(value, (_key, candidate: unknown) => {
      if (typeof candidate === 'bigint' || typeof candidate === 'function' || typeof candidate === 'symbol') {
        throw new TypeError(`found ${typeof candidate}`)
      }
      if (typeof candidate === 'number' && !Number.isFinite(candidate)) {
        throw new TypeError('found a non-finite number')
      }
      return candidate
    })
  } catch (error) {
    throw new TypeError(`${description} must be JSON-serializable when orchestration persistence is enabled.`, {
      cause: error,
    })
  }
}

function stableSerialize(value: unknown): string {
  const seen = new Set<object>()

  const normalize = (candidate: unknown): unknown => {
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') {
      return candidate
    }
    if (typeof candidate === 'number') {
      return Number.isFinite(candidate) ? candidate : { $type: 'number', value: String(candidate) }
    }
    if (candidate === undefined) {
      return { $type: 'undefined' }
    }
    if (typeof candidate === 'bigint') {
      return { $type: 'bigint', value: candidate.toString() }
    }
    if (typeof candidate === 'function' || typeof candidate === 'symbol') {
      throw new TypeError(`Cannot fingerprint a ${typeof candidate} value.`)
    }
    if (Array.isArray(candidate)) {
      return candidate.map(normalize)
    }
    if (typeof candidate === 'object') {
      if (seen.has(candidate)) {
        throw new TypeError('Cannot fingerprint a circular value.')
      }
      seen.add(candidate)
      const normalized = Object.fromEntries(
        Object.entries(candidate)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, normalize(entry)])
      )
      seen.delete(candidate)
      return normalized
    }
    return String(candidate)
  }

  return JSON.stringify(normalize(value))
}

function isPersistedState(value: unknown): value is PersistedOrchestrationState {
  if (!isRecord(value)) {
    return false
  }
  return (
    value.schemaVersion === PERSISTENCE_SCHEMA_VERSION &&
    (value.status === 'running' || value.status === 'completed' || value.status === 'failed') &&
    typeof value.startedAt === 'string' &&
    typeof value.updatedAt === 'string' &&
    isRecord(value.checkpoints) &&
    isRecord(value.graph) &&
    Array.isArray(value.graph.nodes) &&
    Array.isArray(value.graph.edges)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
