import { describe, expect, it } from 'vitest'
import { findExternalEndpoints } from './egress'

describe('findExternalEndpoints', () => {
  it('finds an HTTP host and classifies a POST as a write', () => {
    const endpoints = findExternalEndpoints(
      'requests.post("https://hooks.slack.com/services/T000/B000/XXX", json=rows)'
    )

    expect(endpoints).toEqual([
      {
        host: 'hooks.slack.com',
        scheme: 'https',
        direction: 'write',
        line: 1,
        evidence: 'https://hooks.slack.com/services/T000/B000/XXX',
      },
    ])
  })

  it('classifies a GET as a read', () => {
    expect(findExternalEndpoints('r = requests.get("https://api.github.com/repos")')[0]).toMatchObject({
      host: 'api.github.com',
      direction: 'read',
    })
  })

  it('classifies a bare URL with no surrounding call as unknown', () => {
    expect(findExternalEndpoints('URL = "https://api.stripe.com/v1/charges"')[0]).toMatchObject({
      direction: 'unknown',
    })
  })

  it.each([
    ['df.to_parquet("s3://analytics-exports/churn.parquet")', 's3://analytics-exports', 'write'],
    ['pd.read_csv("gs://raw-events/day.csv")', 'gs://raw-events', 'read'],
    ['client.upload_file(path, "s3://backups/db.sql")', 's3://backups', 'write'],
  ])('reports an object-store bucket as its own endpoint: %s', (code, host, direction) => {
    expect(findExternalEndpoints(code)[0]).toMatchObject({ host, direction })
  })

  it('reads the verb through a call split across lines', () => {
    const code = [
      'requests.post(',
      '    "https://hooks.slack.com/services/T000/B000/XXX",',
      '    json=rows,',
      ')',
    ].join('\n')

    expect(findExternalEndpoints(code)[0]).toMatchObject({ host: 'hooks.slack.com', direction: 'write' })
  })

  it('uses the nearest verb, not any verb in the window', () => {
    const code = 'rows = requests.get(SOURCE).json()\nrequests.post("https://api.stripe.com/v1/charges", json=rows)'

    expect(findExternalEndpoints(code)[0]).toMatchObject({ direction: 'write' })
  })

  it('reports the line of each endpoint', () => {
    const endpoints = findExternalEndpoints('import requests\n\nrequests.post("https://api.stripe.com/v1/charges")')

    expect(endpoints[0].line).toBe(3)
  })

  it('reports the same host once per line but separately across lines', () => {
    const code = [
      'requests.post("https://api.stripe.com/v1/charges", json=a)',
      'requests.post("https://api.stripe.com/v1/charges", json=b)',
    ].join('\n')

    expect(findExternalEndpoints(code).map(e => e.line)).toEqual([1, 2])
    expect(findExternalEndpoints('a = "https://api.stripe.com/x" or "https://api.stripe.com/x"')).toHaveLength(1)
  })

  describe('exclusions', () => {
    it.each([
      'requests.post("http://localhost:8080/ingest")',
      'requests.post("http://127.0.0.1:5000/ingest")',
      'requests.post("http://warehouse.internal/ingest")',
      'requests.post("http://db.local/ingest")',
      'requests.post("http://minio:9000/bucket")',
    ])('ignores the local or private host in %s', code => {
      expect(findExternalEndpoints(code)).toEqual([])
    })

    it('ignores Deepnote itself', () => {
      expect(findExternalEndpoints('requests.post("https://api.deepnote.com/v2/runs")')).toEqual([])
      expect(findExternalEndpoints('requests.get("https://deepnote.com/docs")')).toEqual([])
    })

    it('ignores non-network schemes', () => {
      expect(findExternalEndpoints('open("file:///home/analyst/data.csv")')).toEqual([])
      expect(findExternalEndpoints('img = "data://image/png;base64,AAAA"')).toEqual([])
    })
  })

  describe('redaction', () => {
    it('drops credentials from the reported endpoint', () => {
      const endpoints = findExternalEndpoints('create_engine("postgresql://admin:hunter2@warehouse.example.com/db")')

      expect(endpoints[0]).toMatchObject({ host: 'warehouse.example.com', scheme: 'postgresql' })
      expect(JSON.stringify(endpoints)).not.toContain('hunter2')
      expect(JSON.stringify(endpoints)).not.toContain('admin')
    })

    it('drops the query string, where tokens and identifiers live', () => {
      const endpoints = findExternalEndpoints(
        'requests.get("https://api.example.com/v1/users?token=abc123&email=a@b.c")'
      )

      expect(endpoints[0].evidence).toBe('https://api.example.com/v1/users')
    })

    it('drops the port from the host but keeps the path', () => {
      expect(findExternalEndpoints('requests.post("https://api.example.com:8443/ingest")')[0]).toMatchObject({
        host: 'api.example.com',
        evidence: 'https://api.example.com/ingest',
      })
    })
  })

  it('returns nothing for code with no URIs', () => {
    expect(findExternalEndpoints('df = pd.DataFrame({"a": [1, 2, 3]})\nprint(df.head())')).toEqual([])
    expect(findExternalEndpoints('')).toEqual([])
  })
})

describe('findExternalEndpoints — evidence redaction', () => {
  it('redacts a credential embedded in the path, not only the query string', () => {
    const [endpoint] = findExternalEndpoints(
      `requests.get("https://api.example.com/v1/${'ghp_'}abcdefghijklmnopqrstuvwxyz0123456789AB/export")`
    )

    expect(endpoint.host).toBe('api.example.com')
    expect(endpoint.evidence).not.toContain('abcdefghijklmnop')
    expect(endpoint.evidence).toContain('<redacted>')
  })

  it('still drops the query string entirely', () => {
    const [endpoint] = findExternalEndpoints('requests.get("https://api.example.com/v1/x?token=abc&email=a@b.co")')

    expect(endpoint.evidence).toBe('https://api.example.com/v1/x')
  })

  it('keeps an ordinary path, which is what identifies the endpoint', () => {
    const [endpoint] = findExternalEndpoints('requests.post("https://api.segment.io/v1/track")')

    expect(endpoint.evidence).toBe('https://api.segment.io/v1/track')
  })
})

describe('findExternalEndpoints — a host assembled at run time is not a host', () => {
  it.each([
    ['an f-string placeholder inside the host', 'requests.post(f"https://api.{env}.example.com/ingest", data=df)'],
    ['a printf placeholder', 'requests.post("https://api-%s.example.com/ingest" % env, data=df)'],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the placeholder is the subject under test
    ['a JS template placeholder', 'fetch(`https://api.${env}.example.com/x`, { method: "POST" })'],
    ['a Deepnote parameter', 'requests.post("https://api.{{ region }}.example.com/x", data=df)'],
  ])('records nothing for %s', (_name, content) => {
    // `api.{env` has a dot, so it passes the external-host test and would be inventoried as a real
    // destination. A name nobody can act on is worse than a gap someone knows is there — egress is
    // already documented as a lower bound.
    expect(findExternalEndpoints(content)).toEqual([])
  })

  it('still records the literal hosts around them', () => {
    const endpoints = findExternalEndpoints(
      [
        'requests.post(f"https://api.{env}.example.com/a", data=df)',
        'requests.post("https://hooks.example.com/b")',
      ].join('\n')
    )

    expect(endpoints.map(endpoint => endpoint.host)).toEqual(['hooks.example.com'])
  })

  it('leaves literal hosts with ports, hyphens and bucket names alone', () => {
    expect(findExternalEndpoints('requests.post("https://api-eu.example.com:8443/x")')[0].host).toBe(
      'api-eu.example.com'
    )
    expect(findExternalEndpoints('df.to_csv("s3://exports-bucket/retained.csv")')[0].host).toBe('s3://exports-bucket')
  })
})
