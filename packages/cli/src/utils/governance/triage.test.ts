import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetOutputConfig, setOutputConfig } from '../../output'
import { findDivergence, type QueryObservation } from './sql-divergence'
import { extractQueryFacts } from './sql-facts'
import {
  candidateId,
  DEFAULT_BATCH_SIZE,
  resolveTriageConfig,
  runTriage,
  TRIAGE_ENV,
  TriageCache,
  type TriageCandidate,
  TriageConfigError,
  type TriageProvider,
  type TriageResult,
  toCandidate,
  VERDICT_SIGNAL,
} from './triage'

/** One query in a project, with the location a finding would be reported against. */
function query(projectId: string, sql: string, index = 0): QueryObservation {
  return {
    location: {
      projectId,
      projectName: projectId,
      notebookName: `notebook-${index}`,
      path: `${projectId}/file.deepnote`,
      blockId: `${projectId}-${index}`,
      blockLabel: sql.slice(0, 40),
    },
    facts: extractQueryFacts(sql),
  }
}

function groupsFrom(...queries: string[]) {
  return findDivergence(queries.map((sql, index) => query(`p${index}`, sql, index)))
}

/** A provider that records what it was asked and answers from a fixed script. */
function fakeProvider(
  answer: (candidate: TriageCandidate) => TriageResult | undefined = () => undefined
): TriageProvider & { batches: TriageCandidate[][]; payloads: string[] } {
  const batches: TriageCandidate[][] = []
  const payloads: string[] = []
  return {
    batches,
    payloads,
    async triage(batch) {
      batches.push(batch)
      // Exactly what a real provider would put on the wire, so assertions about what leaves the
      // machine are assertions about the real payload rather than about a convenient subset.
      payloads.push(JSON.stringify({ candidates: batch }))
      return batch.map(candidate => answer(candidate)).filter((r): r is TriageResult => r !== undefined)
    },
  }
}

const JOIN = 'SELECT * FROM orders o JOIN users u ON o.user_id = u.id'
const JOIN_DIVERGENT = 'SELECT * FROM orders o JOIN users u ON o.email = u.email'

describe('resolveTriageConfig', () => {
  it('refuses to invent an endpoint, and says how to set one', () => {
    // The whole point: a compliance tool must not post a workspace's SQL to somebody's cloud
    // because a flag was passed.
    expect(() => resolveTriageConfig({}, {})).toThrow(TriageConfigError)
    expect(() => resolveTriageConfig({}, {})).toThrow(/will not send your SQL anywhere you have not named/)
    expect(() => resolveTriageConfig({}, {})).toThrow(/localhost:11434/)
  })

  it('needs a model as well as an endpoint', () => {
    expect(() => resolveTriageConfig({}, { [TRIAGE_ENV.baseUrl]: 'http://localhost:11434/v1' })).toThrow(
      /needs a model name/
    )
  })

  it('reads the endpoint from the environment', () => {
    const config = resolveTriageConfig(
      {},
      { [TRIAGE_ENV.baseUrl]: 'http://localhost:11434/v1/', [TRIAGE_ENV.model]: 'qwen2.5-coder:7b' }
    )

    expect(config).toMatchObject({ baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:7b' })
    expect(config.apiKey).toBeUndefined()
  })

  it('prefers a flag over the environment', () => {
    const config = resolveTriageConfig(
      { baseUrl: 'http://127.0.0.1:1234/v1', model: 'local' },
      { [TRIAGE_ENV.baseUrl]: 'http://ignored', [TRIAGE_ENV.model]: 'ignored' }
    )

    expect(config).toMatchObject({ baseUrl: 'http://127.0.0.1:1234/v1', model: 'local' })
  })

  it('passes an API key through only when one is set', () => {
    const env = { [TRIAGE_ENV.baseUrl]: 'http://x/v1', [TRIAGE_ENV.model]: 'm', [TRIAGE_ENV.apiKey]: 'sk-local' }
    expect(resolveTriageConfig({}, env).apiKey).toBe('sk-local')
  })
})

describe('toCandidate', () => {
  it('reduces a group to its subject, forms and counts', () => {
    const [group] = groupsFrom(JOIN, JOIN, JOIN, JOIN_DIVERGENT)
    const candidate = toCandidate(group)

    expect(candidate).toMatchObject({ kind: 'join', subject: 'orders ↔ users' })
    expect(candidate.variants.map(v => v.form)).toEqual(['orders.user_id = users.id', 'orders.email = users.email'])
    expect(candidate.variants[0]).toMatchObject({ queryCount: 3, projectCount: 3 })
  })

  it('gives the same id for the same disagreement on any run', () => {
    const [a] = groupsFrom(JOIN, JOIN, JOIN, JOIN_DIVERGENT)
    const [b] = groupsFrom(JOIN, JOIN, JOIN, JOIN_DIVERGENT)

    expect(toCandidate(a).id).toBe(toCandidate(b).id)
    // Form order must not change the id, or a cache hit would depend on iteration order.
    expect(candidateId('join', 'wh', 's', ['a', 'b'])).toBe(candidateId('join', 'wh', 's', ['b', 'a']))
  })

  it('gives different ids to different subjects', () => {
    expect(candidateId('join', 'wh', 'a ↔ b', ['x'])).not.toBe(candidateId('join', 'wh', 'a ↔ c', ['x']))
    expect(candidateId('join', 'wh', 'a ↔ b', ['x'])).not.toBe(candidateId('metric', 'wh', 'a ↔ b', ['x']))
  })

  it('gives different ids to the same disagreement behind two integrations', () => {
    // Groups are scoped per integration, so the same table pair can diverge the same way in two
    // warehouses. Without the scope in the tuple they hash identically, and both the review
    // import and the verdict cache would treat one warehouse's answer as the other's.
    expect(candidateId('join', 'prod', 'a ↔ b', ['x'])).not.toBe(candidateId('join', 'staging', 'a ↔ b', ['x']))
  })

  it('never carries a block or an output, only the grouped forms', () => {
    const [group] = groupsFrom(JOIN, JOIN, JOIN, JOIN_DIVERGENT)
    const serialized = JSON.stringify(toCandidate(group))

    expect(serialized).not.toContain('SELECT')
    expect(serialized).not.toContain('notebook-0')
    expect(serialized).not.toContain('p0')
  })
})

describe('runTriage — what leaves the machine', () => {
  const CREDENTIAL = 'AKIAIOSFODNN7EXAMPLE'
  const ADDRESS = 'jane@acme-corp.io'

  /**
   * A corpus whose variant forms really would carry a credential and an address.
   *
   * A metric variant is the normalized aggregate expression, and that keeps string literals
   * verbatim — so a `CASE WHEN … = '<literal>'` inside an aggregate is the path by which a secret
   * or an address reaches the payload. Join and filter forms are only column names, so they are
   * not the case worth testing.
   */
  function leakyGroups() {
    const withLiteral = (literal: string) =>
      `SELECT sum(CASE WHEN o.tag = '${literal}' THEN o.amount END) AS revenue FROM orders o`
    return groupsFrom(withLiteral(CREDENTIAL), withLiteral(CREDENTIAL), withLiteral(CREDENTIAL), withLiteral(ADDRESS))
  }

  it('the fixture really does put a literal in a variant form', () => {
    // Guards the two tests below: if normalization ever stops carrying literals they would pass
    // for the wrong reason, and the redaction they exist to check would be untested.
    const forms = leakyGroups().flatMap(group => group.variants.map(variant => variant.label))
    expect(forms.join(' ')).toContain(CREDENTIAL)
    expect(forms.join(' ')).toContain(ADDRESS)
  })

  it('redacts a credential and an address out of the payload', async () => {
    const provider = fakeProvider()
    await runTriage(leakyGroups(), { provider })

    expect(provider.payloads.join('\n')).not.toContain(CREDENTIAL)
    expect(provider.payloads.join('\n')).not.toContain(ADDRESS)
  })

  it('keeps them out of the cache file too', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'deepnote-triage-'))
    try {
      const path = join(dir, 'cache.json')
      const cache = new TriageCache(path, 'test-model')
      await runTriage(leakyGroups(), {
        provider: fakeProvider(candidate => ({ id: candidate.id, verdict: 'real', reason: 'differs' })),
        cache,
      })

      const raw = await readFile(path, 'utf8')
      expect(raw).not.toContain(CREDENTIAL)
      expect(raw).not.toContain(ADDRESS)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('bounds the payload by finding count, not by corpus size', async () => {
    // The same two groups, once in a small workspace and once in a large one. What the model sees
    // must not grow with the number of queries behind the groups.
    const small = groupsFrom(JOIN, JOIN, JOIN, JOIN_DIVERGENT)
    const large = findDivergence([
      ...Array.from({ length: 300 }, (_, i) => query(`big${i}`, JOIN, i)),
      query('odd', JOIN_DIVERGENT, 999),
    ])

    const a = fakeProvider()
    const b = fakeProvider()
    await runTriage(small, { provider: a })
    await runTriage(large, { provider: b })

    expect(b.batches.flat()).toHaveLength(a.batches.flat().length)
    // Counts differ, so the strings are not identical — but the size must stay the same order.
    expect(b.payloads.join('').length).toBeLessThan(a.payloads.join('').length * 2)
  })
})

describe('runTriage — batching and limits', () => {
  /** `count` independent join anchors, each with a consensus and one dissenter. */
  function manyGroups(count: number) {
    const observations: QueryObservation[] = []
    for (let i = 0; i < count; i++) {
      const consensus = `SELECT * FROM t${i} JOIN u${i} ON t${i}.id = u${i}.t_id`
      const divergent = `SELECT * FROM t${i} JOIN u${i} ON t${i}.x = u${i}.x`
      observations.push(query(`a${i}`, consensus, i), query(`b${i}`, consensus, i), query(`c${i}`, consensus, i))
      observations.push(query(`d${i}`, divergent, i))
    }
    return findDivergence(observations, { kinds: ['join'] })
  }

  it(`sends at most ${DEFAULT_BATCH_SIZE} candidates per request`, async () => {
    const provider = fakeProvider()
    const groups = manyGroups(60)
    expect(groups.length).toBeGreaterThan(DEFAULT_BATCH_SIZE)

    await runTriage(groups, { provider })

    expect(provider.batches.length).toBeGreaterThan(1)
    expect(Math.max(...provider.batches.map(batch => batch.length))).toBeLessThanOrEqual(DEFAULT_BATCH_SIZE)
  })

  it('honours a limit, keeping the best-attested groups', async () => {
    const provider = fakeProvider()
    const groups = manyGroups(40)

    await runTriage(groups, { provider, limit: 5 })

    const sent = provider.batches.flat()
    expect(sent).toHaveLength(5)
    const best = [...groups].sort((a, b) => b.confidence - a.confidence).slice(0, 5)
    expect(sent.map(c => c.id).sort()).toEqual(best.map(g => toCandidate(g).id).sort())
  })
})

describe('runTriage — cache', () => {
  let dir: string
  let path: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'deepnote-triage-cache-'))
    path = join(dir, 'triage-cache.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('asks on a miss and not on a hit', async () => {
    const groups = groupsFrom(JOIN, JOIN, JOIN, JOIN_DIVERGENT)
    const answer = (candidate: TriageCandidate): TriageResult => ({
      id: candidate.id,
      verdict: 'real',
      reason: 'the join keys differ',
    })

    const first = fakeProvider(answer)
    const miss = await runTriage(groups, { provider: first, cache: new TriageCache(path, 'm1') })
    expect(miss.stats).toMatchObject({ cached: 0, requested: 1 })

    const second = fakeProvider(answer)
    const hit = await runTriage(groups, { provider: second, cache: new TriageCache(path, 'm1') })
    expect(hit.stats).toMatchObject({ cached: 1, requested: 0 })
    // Free and fully offline on a hit, which is what makes this usable in CI.
    expect(second.batches).toEqual([])
    expect(hit.results.get([...miss.results.keys()][0])?.verdict).toBe('real')
  })

  it('keys on the model, so a different model is asked again', async () => {
    const groups = groupsFrom(JOIN, JOIN, JOIN, JOIN_DIVERGENT)
    const answer = (c: TriageCandidate): TriageResult => ({ id: c.id, verdict: 'real', reason: 'r' })

    await runTriage(groups, { provider: fakeProvider(answer), cache: new TriageCache(path, 'small') })
    const other = fakeProvider(answer)
    const run = await runTriage(groups, { provider: other, cache: new TriageCache(path, 'large') })

    expect(run.stats).toMatchObject({ cached: 0, requested: 1 })
  })

  it('treats an unreadable cache as empty rather than failing', async () => {
    const run = await runTriage(groupsFrom(JOIN, JOIN, JOIN, JOIN_DIVERGENT), {
      provider: fakeProvider(c => ({ id: c.id, verdict: 'real', reason: 'r' })),
      cache: new TriageCache(join(dir, 'does', 'not', 'exist.json'), 'm'),
    })

    expect(run.stats.requested).toBe(1)
  })
})

describe('runTriage — failure is never fatal', () => {
  beforeEach(() => {
    resetOutputConfig()
    setOutputConfig({ color: false })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns no verdicts when the provider throws, instead of propagating', async () => {
    const provider: TriageProvider = {
      async triage() {
        throw new Error('connect ECONNREFUSED 127.0.0.1:11434')
      },
    }

    const run = await runTriage(groupsFrom(JOIN, JOIN, JOIN, JOIN_DIVERGENT), { provider })

    expect(run.results.size).toBe(0)
    expect(run.stats.failed).toBe(1)
  })

  it('warns once however many batches fail', async () => {
    const warnSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const provider: TriageProvider = {
      async triage() {
        throw new Error('timeout')
      },
    }

    const groups = findDivergence(
      Array.from({ length: 40 }, (_, i) => i).flatMap(i => [
        query(`a${i}`, `SELECT * FROM t${i} JOIN u${i} ON t${i}.id = u${i}.t_id`, i),
        query(`b${i}`, `SELECT * FROM t${i} JOIN u${i} ON t${i}.id = u${i}.t_id`, i),
        query(`c${i}`, `SELECT * FROM t${i} JOIN u${i} ON t${i}.id = u${i}.t_id`, i),
        query(`d${i}`, `SELECT * FROM t${i} JOIN u${i} ON t${i}.x = u${i}.x`, i),
      ]),
      { kinds: ['join'] }
    )
    await runTriage(groups, { provider })

    const warnings = warnSpy.mock.calls.filter(call => String(call[0]).includes('Triage is unavailable'))
    expect(warnings).toHaveLength(1)
  })

  it('drops a malformed verdict rather than trusting it', async () => {
    const provider: TriageProvider = {
      async triage(batch) {
        return [{ id: batch[0].id, verdict: 'definitely-a-bug' as never, reason: 'nonsense' }]
      },
    }

    const run = await runTriage(groupsFrom(JOIN, JOIN, JOIN, JOIN_DIVERGENT), { provider })

    expect(run.results.size).toBe(0)
    expect(run.stats.failed).toBe(1)
  })

  it('drops a verdict for a candidate it was not asked about', async () => {
    const provider: TriageProvider = {
      async triage() {
        return [{ id: 'not-a-candidate-we-sent', verdict: 'false-positive', reason: 'x' }]
      },
    }

    const run = await runTriage(groupsFrom(JOIN, JOIN, JOIN, JOIN_DIVERGENT), { provider })

    expect(run.results.size).toBe(0)
  })
})

describe('VERDICT_SIGNAL', () => {
  it('ranks a real defect above a deliberate difference, and suppresses a false positive', () => {
    expect(VERDICT_SIGNAL.real).toBeGreaterThan(VERDICT_SIGNAL['legitimate-difference'])
    expect(VERDICT_SIGNAL['legitimate-difference']).toBeGreaterThan(VERDICT_SIGNAL['false-positive'])
    expect(VERDICT_SIGNAL['false-positive']).toBe(0)
  })
})
