import { createHash } from 'node:crypto'

export interface BigQueryOAuthClient {
  clientId: string
  clientSecret: string
  project: string
}

/** Detects that `clientId` / `clientSecret` / `project` changed since the stored token was issued. */
export function computeClientFingerprint(client: BigQueryOAuthClient): string {
  return createHash('sha256').update(`${client.clientId}|${client.clientSecret}|${client.project}`).digest('hex')
}
