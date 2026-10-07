/**
 * Asking a model the question the arithmetic cannot answer.
 *
 * Divergence ranks a group by a Wilson lower bound on its consensus share, then multiplies by a
 * per-kind prior. Wilson measures *how lopsided the split is*. It cannot measure *whether the two
 * forms were ever supposed to agree*, and that is the question that decides whether a finding is
 * worth anyone's time. Several whole classes of false positive are invisible to a lexer:
 *
 *   - a name collision: `revenue` meaning genuinely different things in two teams' notebooks
 *   - qualification only: `x` and `t.x`, identical, reported as a disagreement
 *   - semantically identical forms: `count(1)` and `count(*)`, `concat(a,b)` and `a || b`
 *   - a table pair joined two ways because the two joins answer different questions
 *   - filters and metrics that differ deliberately
 *
 * Normalizing harder is not the fix and must not be used as one. Stripping table qualifiers
 * collapses genuine findings — a table rename that only half the workspace followed looks
 * identical once the qualifier is gone — so canonicalization stays strictly semantics-preserving
 * and the judgment call is handed to a model.
 *
 * ## What this module guarantees
 *
 * **Off unless asked.** No provider means no behaviour change at all: same findings, same order,
 * same exit codes. `--triage` turns it on.
 *
 * **Nothing leaves the machine by accident.** This is a compliance tool, so `--triage` without an
 * explicitly configured endpoint is an error rather than a silent call to somebody's cloud. The
 * resolved endpoint is printed before the first request.
 *
 * **The model never sees the corpus.** It sees pre-grouped variant forms — never a block, never a
 * saved output — and every field is passed through the same secret and subject redaction as the
 * rest of the report before the payload is built. The payload is bounded by finding count, not by
 * workspace size.
 *
 * **A verdict is evidence, not an oracle.** It replaces the hardcoded prior in `signal` and both
 * numbers are recorded, so a reviewer can always tell which one they are reading. A
 * `false-positive` verdict drops a finding out of the ranked list but keeps it in the JSON:
 * suppression has to be inspectable or it is just a smaller number nobody can audit.
 *
 * **It can never fail the run.** Any provider error, timeout or malformed response warns once and
 * falls back to the deterministic score.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { debug, warn } from '../../output'
import { redactSecrets } from './secrets'
import type { DivergenceGroup, DivergenceKind } from './sql-divergence'
import { redactSubjects } from './subjects'

/** One group, reduced to the little a model needs and stripped of anything it must not see. */
export interface TriageCandidate {
  /** Stable across runs and machines: a hash of the kind, the subject and the sorted forms. */
  id: string
  kind: DivergenceKind
  /** What the disagreement is about: a table pair, a table column, or an output name. */
  subject: string
  variants: Array<{ form: string; projectCount: number; queryCount: number }>
  /** The Wilson bound, passed through so the model can see how well attested the split is. */
  confidence: number
}

export type Verdict =
  /** The forms disagree and one of them is wrong. */
  | 'real'
  /** They differ on purpose — different questions, or two things that share a name. */
  | 'legitimate-difference'
  /** They do not actually differ: the same meaning written two ways. */
  | 'false-positive'

export interface TriageResult {
  id: string
  verdict: Verdict
  /** One sentence, shown to the user beside the finding. */
  reason: string
  /** Which variant the model believes is correct. Only meaningful for `real`. */
  canonical?: string
}

export interface TriageProvider {
  triage(batch: TriageCandidate[]): Promise<TriageResult[]>
}

export const VERDICTS: readonly Verdict[] = ['real', 'legitimate-difference', 'false-positive']

/**
 * How much weight a verdict carries as the `signal` factor, in place of the per-kind prior.
 *
 * Still multiplied by the Wilson confidence, so a model that is sure about a thinly attested
 * consensus does not out-rank a well attested one.
 */
export const VERDICT_SIGNAL: Record<Verdict, number> = {
  real: 1,
  // Not wrong, but not nothing either: a deliberate difference is still worth seeing once.
  'legitimate-difference': 0.15,
  // Dropped from the ranked list entirely; kept in the JSON so the suppression is inspectable.
  'false-positive': 0,
}

/** Candidates per request. Small enough that one bad batch is cheap to retry or lose. */
export const DEFAULT_BATCH_SIZE = 25

/** Seconds before a request is abandoned and the deterministic score stands. */
export const DEFAULT_TIMEOUT_MS = 60_000

/** Where verdicts are cached, relative to the audited workspace root. */
export const TRIAGE_CACHE_PATH = join('.deepnote', 'triage-cache.json')

export const TRIAGE_ENV = {
  baseUrl: 'DEEPNOTE_TRIAGE_BASE_URL',
  model: 'DEEPNOTE_TRIAGE_MODEL',
  apiKey: 'DEEPNOTE_TRIAGE_API_KEY',
} as const

/** Everything needed to reach a model, once flags and environment have been reconciled. */
export interface TriageConfig {
  baseUrl: string
  model: string
  apiKey?: string
  timeoutMs: number
}

export class TriageConfigError extends Error {}

/**
 * Resolve the endpoint from flags and environment, or explain how to set one.
 *
 * Deliberately has no default endpoint. A governance tool that quietly posts a workspace's SQL to
 * a hosted API the first time someone passes a flag is worse than one that does not have the
 * feature, so the absence of configuration is an error with instructions rather than a fallback.
 */
export function resolveTriageConfig(
  flags: { baseUrl?: string; model?: string; timeoutMs?: number } = {},
  env: Record<string, string | undefined> = process.env
): TriageConfig {
  const baseUrl = flags.baseUrl ?? env[TRIAGE_ENV.baseUrl]
  const model = flags.model ?? env[TRIAGE_ENV.model]

  if (!baseUrl) {
    throw new TriageConfigError(
      `--triage needs a model endpoint, and there is no default: this command will not send your SQL anywhere you have not named.\n` +
        `Point it at a local model, for example:\n` +
        `  export ${TRIAGE_ENV.baseUrl}=http://localhost:11434/v1   # Ollama\n` +
        `  export ${TRIAGE_ENV.model}=qwen2.5-coder:7b\n` +
        `Any OpenAI-compatible endpoint works, including LM Studio and vLLM. ` +
        `${TRIAGE_ENV.apiKey} is optional and only sent when set.`
    )
  }
  if (!model) {
    throw new TriageConfigError(`--triage needs a model name. Set ${TRIAGE_ENV.model} or pass --triage-model.`)
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model,
    apiKey: env[TRIAGE_ENV.apiKey],
    timeoutMs: flags.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }
}

/** Mask anything a variant form or a subject might carry out of the workspace. */
function scrub(text: string): string {
  return redactSubjects(redactSecrets(text))
}

/**
 * A stable id for a group: the same disagreement gets the same id on any machine, on any run.
 *
 * Built from the redacted forms, so the id of a candidate is a function of exactly what the model
 * is shown — which is what lets a cached verdict be trusted.
 */
export function candidateId(kind: DivergenceKind, subject: string, forms: string[]): string {
  const canonical = JSON.stringify([kind, subject, [...forms].sort()])
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

/** Reduce a divergence group to a redacted candidate. */
export function toCandidate(group: DivergenceGroup): TriageCandidate {
  const subject = scrub(group.anchorLabel)
  const variants = group.variants.map(variant => ({
    form: scrub(variant.label),
    projectCount: new Set(variant.members.map(member => member.location.projectId)).size,
    queryCount: variant.members.length,
  }))

  return {
    id: candidateId(
      group.kind,
      subject,
      variants.map(variant => variant.form)
    ),
    kind: group.kind,
    subject,
    variants,
    confidence: Number(group.confidence.toFixed(4)),
  }
}

// ---------------------------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------------------------

interface CacheFile {
  version: 1
  /** Keyed `${model}:${candidateId}` — a verdict is only valid for the model that gave it. */
  entries: Record<string, TriageResult>
}

export class TriageCache {
  private entries: Record<string, TriageResult> = {}
  private loaded = false
  private dirty = false

  constructor(
    private readonly path: string,
    private readonly model: string
  ) {}

  private key(id: string): string {
    return `${this.model}:${id}`
  }

  async load(): Promise<void> {
    if (this.loaded) {
      return
    }
    this.loaded = true
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as CacheFile
      if (parsed.version === 1 && parsed.entries) {
        this.entries = parsed.entries
      }
    } catch {
      // A missing or corrupt cache is not an error: it only ever makes the run slower.
      debug(`No usable triage cache at ${this.path}`)
    }
  }

  get(id: string): TriageResult | undefined {
    return this.entries[this.key(id)]
  }

  set(result: TriageResult): void {
    this.entries[this.key(result.id)] = result
    this.dirty = true
  }

  /** Written through a temp file, for the same reason the subject index is. */
  async save(): Promise<void> {
    if (!this.dirty) {
      return
    }
    const file: CacheFile = { version: 1, entries: this.entries }
    const temporary = `${this.path}.${Math.random().toString(36).slice(2, 8)}.tmp`
    try {
      await mkdir(dirname(this.path), { recursive: true })
      await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`)
      await rename(temporary, this.path)
      this.dirty = false
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => {})
      // The cache is an optimization. Failing to persist it must not fail the audit.
      warn(`Could not write the triage cache: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------------------------

export interface RunTriageOptions {
  provider: TriageProvider
  cache?: TriageCache
  /** Most confident first; this caps how many are sent. */
  limit?: number
  batchSize?: number
}

export interface TriageRun {
  /** Verdicts by candidate id, from the cache and from the provider alike. */
  results: Map<string, TriageResult>
  /** How many verdicts came from the cache, and how many cost a request. */
  stats: { candidates: number; cached: number; requested: number; failed: number }
}

/**
 * Triage `groups`, newest evidence first.
 *
 * Sorted by confidence descending so that if `limit` cuts the list, what survives is the part of
 * it a reviewer would have looked at first.
 */
export async function runTriage(groups: DivergenceGroup[], options: RunTriageOptions): Promise<TriageRun> {
  const ranked = [...groups].sort((a, b) => b.confidence - a.confidence)
  const candidates = ranked.slice(0, options.limit ?? ranked.length).map(toCandidate)
  const results = new Map<string, TriageResult>()
  const stats = { candidates: candidates.length, cached: 0, requested: 0, failed: 0 }

  await options.cache?.load()

  const pending: TriageCandidate[] = []
  for (const candidate of candidates) {
    const hit = options.cache?.get(candidate.id)
    if (hit) {
      results.set(candidate.id, hit)
      stats.cached++
    } else {
      pending.push(candidate)
    }
  }

  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  let warned = false
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize)
    try {
      const batchResults = await options.provider.triage(batch)
      const byId = new Map(batchResults.map(result => [result.id, result]))
      for (const candidate of batch) {
        const result = byId.get(candidate.id)
        if (!result || !VERDICTS.includes(result.verdict)) {
          stats.failed++
          continue
        }
        results.set(candidate.id, result)
        options.cache?.set(result)
        stats.requested++
      }
    } catch (error) {
      stats.failed += batch.length
      // Warn once, however many batches fail: a wall of identical warnings buries the findings
      // the command exists to print.
      if (!warned) {
        warned = true
        warn(
          `Triage is unavailable, so findings keep their deterministic score: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    }
  }

  await options.cache?.save()
  return { results, stats }
}

// ---------------------------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------------------------

const SYSTEM_PROMPT = [
  'You review SQL consistency findings from a data workspace.',
  'Each candidate is one subject — a table pair, a table column, or an output name — that two or',
  'more queries define differently. Decide whether the difference is a defect.',
  '',
  'Answer for each candidate with exactly one verdict:',
  '  "real"                  the forms disagree and one of them is wrong',
  '  "legitimate-difference" they differ on purpose: different questions, or one name meaning two things',
  '  "false-positive"        they do not actually differ: the same meaning written two ways,',
  '                          such as count(1) and count(*), or a qualifier that changes nothing',
  '',
  'Give a one-sentence reason. For "real", also give "canonical": the variant form that is correct.',
  'Reply with JSON only: {"results":[{"id":"...","verdict":"...","reason":"...","canonical":"..."}]}',
].join('\n')

/** The response shape, validated by hand so this file needs no schema dependency. */
function parseResults(payload: unknown): TriageResult[] {
  const root = payload as { results?: unknown }
  if (!root || !Array.isArray(root.results)) {
    throw new Error('response had no "results" array')
  }
  const results: TriageResult[] = []
  for (const entry of root.results) {
    const row = entry as Partial<TriageResult>
    if (typeof row?.id !== 'string' || typeof row.verdict !== 'string' || !VERDICTS.includes(row.verdict as Verdict)) {
      continue
    }
    results.push({
      id: row.id,
      verdict: row.verdict as Verdict,
      reason: typeof row.reason === 'string' ? row.reason.trim().slice(0, 300) : '',
      ...(typeof row.canonical === 'string' ? { canonical: row.canonical } : {}),
    })
  }
  return results
}

/**
 * An OpenAI-compatible chat provider.
 *
 * This is the single place a model is constructed, and the only place that knows a wire format.
 * Swapping it for `resolveAgentModel` from `@deepnote/runtime-core` (PR #549) plus `generateObject`
 * is a change to this function and nothing else.
 *
 * It speaks plain `fetch` rather than the AI SDK because `ai` and `@ai-sdk/openai` are transitive
 * dependencies of `@deepnote/runtime-core` and are not resolvable from `packages/cli` under pnpm's
 * strict layout. Declaring them here would be a dependency change in a stack that otherwise has
 * none. `/chat/completions` is what Ollama, LM Studio and vLLM all expose anyway.
 */
export function createOpenAiCompatibleProvider(config: TriageConfig): TriageProvider {
  return {
    async triage(batch: TriageCandidate[]): Promise<TriageResult[]> {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), config.timeoutMs)

      try {
        const response = await fetch(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: config.model,
            // Deterministic, so a re-run without a cache gives the same ranking.
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: JSON.stringify({ candidates: batch }) },
            ],
          }),
        })

        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`)
        }

        const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
        const content = body.choices?.[0]?.message?.content
        if (typeof content !== 'string') {
          throw new Error('response had no message content')
        }
        return parseResults(JSON.parse(content))
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
