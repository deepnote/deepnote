import { describe, expect, it } from 'vitest'
import { findSecrets, fingerprintSecret, redactSecrets } from './secrets'

/**
 * Synthetic credentials for the provider patterns, assembled from their prefix at runtime.
 *
 * Written out whole they would be flagged by secret scanners — GitHub's push protection rejects a
 * push containing them even though no such key was ever issued — and a test suite that cannot be
 * pushed is worse than one that spells its fixtures out. Splitting the literal is enough: scanners
 * read the source text, and `findSecrets` only ever sees the joined value.
 */
const SLACK_TOKEN = `xoxb-${'123456789012'}-${'abcdefghijklmnop'}`
const STRIPE_KEY = `sk_live_${'4eC39HqLyjWDarjtT1zdp7dc'}`

describe('findSecrets', () => {
  describe('provider patterns', () => {
    it.each([
      ['AWS access key ID', 'session = boto3.Session(aws_access_key_id="AKIAIOSFODNN7EXAMPLE")'],
      ['GitHub token', 'headers = {"Authorization": "token ghp_016C7e42F292c6912E7710c838347Ae178B4a"}'],
      ['Slack token', `client = WebClient(token="${SLACK_TOKEN}")`],
      ['Stripe key', `stripe.api_key = "${STRIPE_KEY}"`],
      ['Google API key', 'url = "https://maps.googleapis.com/?key=AIzaSyD-1234567890abcdefghijklmnopqrstu"'],
      ['Private key', 'key = """-----BEGIN RSA PRIVATE KEY-----\nMIIE..."""'],
    ])('detects a %s', (kind, content) => {
      const findings = findSecrets(content)

      expect(findings.map(f => f.kind)).toContain(kind)
      expect(findings.every(f => f.confidence === 'pattern')).toBe(true)
    })

    it('detects a password embedded in a connection string and fingerprints only the password', () => {
      const findings = findSecrets(
        'engine = create_engine("postgresql://admin:hunter2pass@db.internal:5432/analytics")'
      )

      expect(findings).toHaveLength(1)
      expect(findings[0].kind).toBe('Connection string password')
      expect(findings[0].fingerprint).toBe(fingerprintSecret('hunter2pass'))
    })

    it('does not flag a connection string without a password', () => {
      expect(findSecrets('engine = create_engine("postgresql://db.internal:5432/analytics")')).toEqual([])
    })

    it('reports the line of each match', () => {
      const findings = findSecrets('import boto3\n\nKEY = "AKIAIOSFODNN7EXAMPLE"')

      expect(findings[0].line).toBe(3)
    })

    it('finds every occurrence, including repeats of the same credential', () => {
      const findings = findSecrets('a = "AKIAIOSFODNN7EXAMPLE"\nb = "AKIAIOSFODNN7EXAMPLE"')

      expect(findings).toHaveLength(2)
      expect(findings[0].fingerprint).toBe(findings[1].fingerprint)
    })

    it('is stateless across calls', () => {
      const content = 'KEY = "AKIAIOSFODNN7EXAMPLE"'

      expect(findSecrets(content)).toEqual(findSecrets(content))
    })
  })

  describe('secret-named assignments', () => {
    it('flags a long literal assigned to a secret-named variable', () => {
      const findings = findSecrets('api_key = "9f8e7d6c5b4a39281706"')

      expect(findings).toHaveLength(1)
      expect(findings[0]).toMatchObject({
        confidence: 'heuristic',
        variable: 'api_key',
        fingerprint: fingerprintSecret('9f8e7d6c5b4a39281706'),
      })
    })

    it('flags secret-named keys in dict and YAML style', () => {
      expect(findSecrets('config = {"db_password": "0f1e2d3c4b5a6978"}')).toHaveLength(1)
      expect(findSecrets('client_secret: "abcdef0123456789"')).toHaveLength(1)
    })

    it('flags a key-shaped value under a weaker name', () => {
      expect(findSecrets('SEGMENT_KEY = "9f8e7d6c5b4a39281706"')).toHaveLength(1)
      expect(findSecrets('auth = "a1b2c3d4e5f60718293a"')).toHaveLength(1)
    })

    it('does not flag a weaker name whose value is not key-shaped', () => {
      expect(findSecrets('sort_key = "customer_region"')).toEqual([])
      expect(findSecrets('partition_key = "created_at_month"')).toEqual([])
      expect(findSecrets('key = "daily active users"')).toEqual([])
      expect(findSecrets('cache_key = "report-2026-q1"')).toEqual([])
    })

    it('does not flag values read from the environment', () => {
      expect(findSecrets('api_key = os.environ["API_KEY"]')).toEqual([])
      expect(findSecrets('token = os.getenv("GITHUB_TOKEN", "")')).toEqual([])
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the `${...}` is the scanned input
      expect(findSecrets('password = "${DB_PASSWORD}"')).toEqual([])
      expect(findSecrets('password = "{{ db_password }}"')).toEqual([])
    })

    it('does not flag placeholders', () => {
      for (const value of ['<your-key-here>', 'your-api-key', 'changeme', 'xxxxxxxxxx', '********', '']) {
        expect(findSecrets(`api_key = "${value}"`)).toEqual([])
      }
    })

    it('does not flag an env var name used as a value', () => {
      expect(findSecrets('secret_name = "SNOWFLAKE_PASSWORD"')).toEqual([])
    })

    it('does not flag short values', () => {
      expect(findSecrets('password = "abc123"')).toEqual([])
    })

    it('does not flag ordinary variables with long values', () => {
      expect(findSecrets('query_name = "daily_active_users_by_region"')).toEqual([])
      expect(findSecrets('path = "/home/analyst/data/warehouse_export.csv"')).toEqual([])
    })

    it('can be turned off for prose content', () => {
      const content = 'Set api_key = "9f8e7d6c5b4a39281706" in your config'

      expect(findSecrets(content)).toHaveLength(1)
      expect(findSecrets(content, { includeHeuristic: false })).toEqual([])
    })

    it('still reports provider patterns when the heuristic rule is off', () => {
      expect(findSecrets('Use AKIAIOSFODNN7EXAMPLE', { includeHeuristic: false })).toHaveLength(1)
    })
  })

  it('reports a credential matched by both rules once', () => {
    const findings = findSecrets('github_token = "ghp_016C7e42F292c6912E7710c838347Ae178B4a"')

    expect(findings).toHaveLength(1)
    expect(findings[0].kind).toBe('GitHub token')
  })

  it('never includes the secret itself in the finding', () => {
    const secret = 'AKIAIOSFODNN7EXAMPLE'
    const findings = findSecrets(`key = "${secret}"`)

    expect(JSON.stringify(findings)).not.toContain(secret)
  })

  it('returns findings in line order', () => {
    const findings = findSecrets('a = "AKIAIOSFODNN7EXAMPLE"\n\n\napi_key = "9f8e7d6c5b4a39281706"')

    expect(findings.map(f => f.line)).toEqual([1, 4])
  })
})

describe('redactSecrets', () => {
  it('masks a provider-pattern credential', () => {
    expect(redactSecrets('key = "AKIAIOSFODNN7EXAMPLE"')).toBe('key = "<redacted>"')
  })

  it('masks a credential found by the heuristic rule', () => {
    expect(redactSecrets('api_key = "9f8e7d6c5b4a39281706"')).toBe('api_key = "<redacted>"')
  })

  it('masks only the password inside a connection string', () => {
    expect(redactSecrets('postgresql://admin:hunter2pass@db.internal/analytics')).toBe(
      'postgresql://admin:<redacted>@db.internal/analytics'
    )
  })

  it('masks every credential in a multi-line block', () => {
    const redacted = redactSecrets('a = "AKIAIOSFODNN7EXAMPLE"\nb = "AKIAJ7PQRSTUVWXY2345"')

    expect(redacted).toBe('a = "<redacted>"\nb = "<redacted>"')
  })

  it('leaves text without credentials unchanged', () => {
    expect(redactSecrets('df = pd.read_csv("data.csv")')).toBe('df = pd.read_csv("data.csv")')
    expect(redactSecrets('')).toBe('')
  })

  it('is idempotent', () => {
    const once = redactSecrets('key = "AKIAIOSFODNN7EXAMPLE"')

    expect(redactSecrets(once)).toBe(once)
  })
})

describe('fingerprintSecret', () => {
  it('is stable, 16 hex characters, and differs per value', () => {
    expect(fingerprintSecret('a')).toBe(fingerprintSecret('a'))
    expect(fingerprintSecret('a')).toMatch(/^[0-9a-f]{16}$/)
    expect(fingerprintSecret('a')).not.toBe(fingerprintSecret('b'))
  })
})
