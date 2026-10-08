/**
 * Where a notebook sends data, read from the code itself.
 *
 * A Deepnote project declares its *ingress* — the integrations it reads from are listed in the
 * project file. Egress is undeclared by construction: a notebook reaches a third party through an
 * ordinary HTTP call or an object-store write buried in a code block, and nothing records that it
 * happened. This module recovers those edges by finding URIs in block content and deciding, from
 * the call around each one, whether data is leaving.
 *
 * It is a lower bound and says so: a host assembled from variables at runtime is invisible here.
 * What it does find is exact — a hostname written into a notebook is a hostname that notebook talks
 * to.
 */

import { redactSecrets } from './secrets'

/** Direction of the data flow, as far as the surrounding call reveals. */
export type EgressDirection = 'write' | 'read' | 'unknown'

export interface ExternalEndpoint {
  /** Hostname, lower-cased; for object stores, the bucket as `s3://bucket`. */
  host: string
  /** URI scheme: `https`, `s3`, `postgresql`, … */
  scheme: string
  direction: EgressDirection
  /** One-based line within the scanned content. */
  line: number
  /** The matched URI with any credentials and query string removed. */
  evidence: string
}

/** URIs in block content. The authority stops at whitespace, quotes, or a closing bracket. */
const URI_PATTERN = /\b([a-z][a-z0-9+.-]{1,15}):\/\/([^\s'"`)\]},]+)/gi

/**
 * Schemes whose authority is a bucket rather than a host. The bucket is the unit that matters:
 * two notebooks writing to different buckets on the same provider are different egress paths.
 */
const BUCKET_SCHEMES = new Set(['s3', 's3a', 's3n', 'gs', 'gcs', 'abfs', 'abfss', 'wasb', 'wasbs'])

/** Schemes that never leave the machine. */
const LOCAL_SCHEMES = new Set(['file', 'data', 'javascript', 'about', 'chrome'])

/** Hosts that are the local machine or the notebook's own runtime. */
const LOCAL_HOST_PATTERN =
  /^(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[?::1]?|.*\.local|.*\.internal|host\.docker\.internal)$/i

/** Deepnote's own endpoints. Traffic to these is first-party and not egress. */
const FIRST_PARTY_HOST_PATTERN = /(?:^|\.)deepnote\.(?:com|net|dev)$/i

/** Call verbs that mean data is going out. */
const WRITE_VERBS = new Set([
  'post',
  'put',
  'patch',
  'upload',
  'upload_file',
  'upload_fileobj',
  'put_object',
  'copy_object',
  'to_csv',
  'to_parquet',
  'to_json',
  'to_sql',
  'to_gbq',
  'write',
  'write_csv',
  'write_parquet',
  'send',
  'send_message',
  'publish',
  'insert',
  'sink',
  'export',
])

/** Call verbs that mean data is coming in. */
const READ_VERBS = new Set([
  'get',
  'read',
  'read_csv',
  'read_parquet',
  'read_json',
  'read_sql',
  'read_gbq',
  'download',
  'download_file',
  'fetch',
  'load',
  'list_objects',
  'head',
])

/** A verb immediately followed by a call, assignment, or attribute access. */
const VERB_PATTERN = /\b([a-z_][a-z0-9_]*)\s*[(=.]/gi

/** How much of the preceding text to inspect for the verb. */
const CONTEXT_WINDOW = 160

function lineAt(content: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content[i] === '\n') {
      line++
    }
  }
  return line
}

/**
 * Split an authority into its host, dropping any `user:password@` prefix and `:port` suffix.
 * Credentials are discarded rather than reported: the credential checks fingerprint them, and this
 * module's output is an inventory meant to be shared.
 */
function hostOf(authority: string): string {
  // Only the segment before the first `/` is the authority; an `@` later in the URI belongs to the
  // path or query string (`?email=a@b.c`) and must not be mistaken for a credentials separator.
  const authorityOnly = authority.split('/')[0]
  const hostAndPort = authorityOnly.includes('@')
    ? authorityOnly.slice(authorityOnly.lastIndexOf('@') + 1)
    : authorityOnly
  const host = hostAndPort.startsWith('[')
    ? // IPv6 literal: `[::1]:8080`.
      (hostAndPort.match(/^\[[^\]]*]/)?.[0] ?? hostAndPort)
    : hostAndPort.split(':')[0]
  return host.toLowerCase()
}

/**
 * A literal hostname or bucket name: letters, digits, dots, hyphens, underscores — or a complete
 * bracketed IPv6 literal. Nothing else is legal in a host, so anything else is a sign the URI was
 * assembled at run time.
 *
 * The IPv6 arm is defensive rather than reachable today: `URI_PATTERN` excludes `]` so the
 * authority stops at `[2001:db8::1`, which this correctly rejects as the fragment it is. Written
 * out so that widening the scanner later does not silently start dropping real addresses.
 */
const LITERAL_HOST_PATTERN = /^[a-z0-9._-]+$|^\[[0-9a-f:.]*]$/

/**
 * True when `host` is a name the author actually wrote, rather than a fragment of one they built.
 *
 * `f"https://api.{env}.example.com/x"` leaves `api.{env` once the scanner stops at the brace, and
 * `"https://api-%s.example.com/x" % env` leaves `api-%s.example.com`. Both look like hosts —
 * `api.{env` even has a dot, so it clears the external-host test — and both would be recorded in
 * an inventory whose whole value is that the names in it are real.
 *
 * Recording nothing is the right trade. The egress list is already documented as a lower bound,
 * and a host nobody can act on is worse than a gap someone knows is there: a fragment invites
 * someone to search for a host that does not exist.
 */
function isLiteralHost(host: string): boolean {
  return LITERAL_HOST_PATTERN.test(host)
}

/** True when `host` is somewhere data could actually leave to. */
function isExternalHost(host: string): boolean {
  if (host === '' || LOCAL_HOST_PATTERN.test(host) || FIRST_PARTY_HOST_PATTERN.test(host)) {
    return false
  }
  // A bare word with no dot is a container or service name on a private network, not a public host.
  return host.includes('.') || host.includes(':')
}

/**
 * Classify the flow from the call the URI sits inside.
 *
 * The window spans newlines, because the call that matters is routinely split across lines:
 *
 *     requests.post(
 *         "https://hooks.slack.com/services/…",
 *         json=payload,
 *     )
 *
 * Only the *last* verb before the URI is used. Scanning the window for any write verb would let an
 * unrelated earlier statement decide the direction, which is how an inventory ends up claiming
 * exports that never happened.
 */
function directionAt(content: string, offset: number): EgressDirection {
  const context = content.slice(Math.max(0, offset - CONTEXT_WINDOW), offset)

  let lastVerb: string | undefined
  VERB_PATTERN.lastIndex = 0
  let match = VERB_PATTERN.exec(context)
  while (match !== null) {
    const verb = match[1].toLowerCase()
    if (WRITE_VERBS.has(verb) || READ_VERBS.has(verb)) {
      lastVerb = verb
    }
    match = VERB_PATTERN.exec(context)
  }

  if (lastVerb === undefined) {
    return 'unknown'
  }
  return WRITE_VERBS.has(lastVerb) ? 'write' : 'read'
}

/**
 * Find every external endpoint referenced in `content`.
 *
 * Duplicate (host, direction) pairs on the same line are collapsed; the same host reached from
 * several lines is reported once per line, because each is a separate place to change.
 */
export function findExternalEndpoints(content: string): ExternalEndpoint[] {
  const endpoints: ExternalEndpoint[] = []
  const seen = new Set<string>()

  URI_PATTERN.lastIndex = 0
  let match = URI_PATTERN.exec(content)
  while (match !== null) {
    const scheme = match[1].toLowerCase()
    const authority = match[2]
    const current = match
    match = URI_PATTERN.exec(content)

    if (LOCAL_SCHEMES.has(scheme)) {
      continue
    }

    const isBucket = BUCKET_SCHEMES.has(scheme)
    const rawHost = hostOf(authority)
    if (!isLiteralHost(rawHost)) {
      continue
    }
    if (!isBucket && !isExternalHost(rawHost)) {
      continue
    }
    if (isBucket && rawHost === '') {
      continue
    }

    const host = isBucket ? `${scheme}://${rawHost}` : rawHost
    const line = lineAt(content, current.index)
    const direction = directionAt(content, current.index)
    const key = `${host}:${direction}:${line}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)

    // Keep the path — it identifies the endpoint — but drop the query string, which is where
    // tokens and personal identifiers end up. The path is not safe either: an API key embedded in
    // a route (`/v1/ghp_…/export`) survives dropping the query, so the assembled evidence goes
    // through the same redaction as every other string this layer reports. `rawHost` already has
    // any `user:pass@` userinfo stripped by `hostOf`.
    const pathStart = authority.indexOf('/')
    const path = pathStart === -1 ? '' : authority.slice(pathStart).split('?')[0]
    const evidence = redactSecrets(`${scheme}://${rawHost}${path}`)

    endpoints.push({ host, scheme, direction, line, evidence })
  }

  return endpoints
}
