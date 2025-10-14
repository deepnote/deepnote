export interface TableState {
  cellFormattingRules?: { column: string; rule: string }[]
  columnDisplayNames?: { columnName: string; displayName: string }[]
  columnOrder?: string[]
  conditionalFilters?: unknown[]
  filters?: { id: string; value: string }[]
  hiddenColumnIds?: string[]
  pageIndex?: number
  pageSize?: number
  sortBy?: { id: string; desc: boolean }[]
  wrappedTextColumnIds?: string[]
}
