export const TOOL_NAMES = {
  // Reading tools
  read: 'deepnote_read',
  cat: 'deepnote_cat',
  validate: 'deepnote_validate',
  diff: 'deepnote_diff',
  // Writing tools
  create: 'deepnote_create',
  addBlock: 'deepnote_add_block',
  editBlock: 'deepnote_edit_block',
  removeBlock: 'deepnote_remove_block',
  reorderBlocks: 'deepnote_reorder_blocks',
  addNotebook: 'deepnote_add_notebook',
  // Conversion tools
  convertTo: 'deepnote_convert_to',
  convertFrom: 'deepnote_convert_from',
  // Execution tools
  run: 'deepnote_run',
  // Snapshot tools
  snapshotList: 'deepnote_snapshot_list',
  snapshotLoad: 'deepnote_snapshot_load',
  snapshotSplit: 'deepnote_snapshot_split',
  snapshotMerge: 'deepnote_snapshot_merge',
} as const

export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES]

export const ALL_TOOL_NAMES: readonly ToolName[] = Object.values(TOOL_NAMES)
