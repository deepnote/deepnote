/**
 * Browser bundle entry point: run a pipeline, and read its results, in a web page.
 *
 * The whole package is browser-safe — nothing in it imports `node:*` — so this is the same surface
 * as `index.ts`, plus the cloud calls a page needs around a pipeline. It exists as its own entry
 * only to be bundled self-contained for a page that has no bundler of its own, and to say plainly
 * that the browser is a first-class target: steps run in Deepnote Cloud over `fetch`, addressed by
 * notebook id and authorized by a short-lived, viewer-scoped token, so no long-lived secret and no
 * application server is involved.
 *
 * Rendering is deliberately not included: a DOM renderer is a page concern, and the shapes it
 * produces (how a table looks, whether HTML output is sandboxed) belong to the page, not the
 * library. See `examples/local-runner/run-app` for a complete one.
 */

// The cloud calls a page makes around a pipeline — run one notebook and follow it, show a past run,
// read a notebook's inputs, list its history, schedule it. The engine only needs the first of these,
// but a page without a bundler has nowhere else to get the rest, so they ride along here rather than
// leaving the page to hand-roll requests the library already normalizes.
export type {
  BlockRequestOptions,
  FetchSnapshotOptions,
  GetRunOptions,
  ListRunsOptions,
  NormalizedRun,
  NotebookDetail,
  NotebookInput,
  NotebookSchedule,
  PollOptions,
  RunInputValue,
  RunStatus,
  RunSummary,
  RunsPage,
  ScheduleRequestOptions,
  SettledRunSnapshot,
  TriggerRunBody,
  UpsertNotebookScheduleBody,
  WaitForRunSnapshotOptions,
} from '@deepnote/cloud'
export {
  describeRunError,
  fetchSnapshotContent,
  getNotebook,
  getRun,
  isFailedStatus,
  isSuccessStatus,
  isTerminalStatus,
  listNotebookRuns,
  pollRunUntilComplete,
  RUN_STATUSES,
  RunTimeoutError,
  triggerNotebookRun,
  upsertNotebookSchedule,
  waitForRunSnapshot,
} from '@deepnote/cloud'
export * from './index'
