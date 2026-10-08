/**
 * What the SQL checks need to know about the warehouse a query was written for.
 *
 * The checks are deliberately lexical — no grammar, no schema — and that is what lets them run on
 * templated queries a real parser would reject. But a handful of questions are genuinely not
 * answerable from the text alone, because the same characters mean different things to different
 * warehouses. This module holds only those, keyed by the integration type already recorded on the
 * block, so the rest of the checks stay dialect-agnostic.
 */

import { isSqlIntegrationType, type SqlIntegrationType } from '@deepnote/database-integrations'

/**
 * Dialects where a double-quoted token is a *string literal* rather than a quoted identifier.
 *
 * MySQL and MariaDB read `"x"` as a string unless `ANSI_QUOTES` is set, and BigQuery reads it as a
 * string always — all three spell identifiers with backticks. Everywhere else in
 * `sqlIntegrationTypes`, double quotes are the SQL-standard identifier quote.
 *
 * Deliberately conservative. Spark-derived engines are the ambiguous case: Spark SQL historically
 * reads `"x"` as a string, but Databricks warehouses run with ANSI mode on, where it is an
 * identifier. A query is only flagged where the answer does not depend on a session setting, so
 * `databricks` is absent and its double-quoted comparisons are left alone.
 */
const DOUBLE_QUOTED_STRING_DIALECTS = new Set<SqlIntegrationType>(['mysql', 'mariadb', 'big-query'])

/** The dialect-dependent facts a check may consult. */
export interface SqlDialect {
  /** The integration type this was resolved from, or `undefined` when the block declares none. */
  type?: SqlIntegrationType
  /**
   * Whether `"x"` is a string literal here.
   *
   * `false` when unknown, so a block with no integration is treated as identifier-quoting. That is
   * the direction that stays silent rather than guessing: a false `sql-string-boolean` on a
   * perfectly good `WHERE "flag" = ...` is worse than a missed one, and the comparison is only
   * wrong at all in the dialects that coerce.
   */
  doubleQuotesAreStrings: boolean
}

/** The dialect assumed when a block declares no integration, or one that is not a SQL integration. */
export const UNKNOWN_DIALECT: SqlDialect = { doubleQuotesAreStrings: false }

/** Resolve the dialect for a block, given its integration id and the project's integration list. */
export function resolveDialect(
  integrationId: string | undefined,
  integrationTypesById: ReadonlyMap<string, string>
): SqlDialect {
  if (integrationId === undefined) {
    return UNKNOWN_DIALECT
  }
  const type = integrationTypesById.get(integrationId)
  if (type === undefined || !isSqlIntegrationType(type)) {
    return UNKNOWN_DIALECT
  }
  return { type, doubleQuotesAreStrings: DOUBLE_QUOTED_STRING_DIALECTS.has(type) }
}

/** Index a project's integrations by id, keeping only those that declare a type. */
export function integrationTypesById(
  integrations: ReadonlyArray<{ id: string; type?: string }> | undefined
): Map<string, string> {
  const byId = new Map<string, string>()
  for (const integration of integrations ?? []) {
    if (typeof integration.type === 'string') {
      byId.set(integration.id, integration.type)
    }
  }
  return byId
}
