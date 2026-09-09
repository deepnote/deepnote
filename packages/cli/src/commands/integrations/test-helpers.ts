/**
 * An integrations file left with unresolved git merge conflict markers. The file reads
 * fine; it just is not valid YAML.
 */
export const CONFLICT_MARKERS_YAML = [
  'integrations:',
  '<<<<<<< HEAD',
  '  - id: a',
  '=======',
  '  - id: b',
  '>>>>>>> branch',
  '',
].join('\n')
