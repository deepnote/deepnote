/**
 * A non-fatal validation issue encountered while parsing an integrations file.
 */
export interface ValidationIssue {
  /** Dotted path to the offending value (e.g. `integrations[0].metadata.password`). */
  path: string
  /** Human-readable description of the issue. */
  message: string
  /** Machine-readable code (e.g. `yaml_parse_error`, `env_var_not_defined`). */
  code: string
}
