/**
 * Browser bundle entry point: run a pipeline, and read its results, in a web page.
 *
 * The whole package is browser-safe — nothing in it imports `node:*` — so this is the same surface
 * as `index.ts`. It exists as its own entry only to be bundled self-contained for a page that has
 * no bundler of its own, and to say plainly that the browser is a first-class target: steps run in
 * Deepnote Cloud over `fetch`, addressed by notebook id and authorized by a short-lived,
 * viewer-scoped token, so no long-lived secret and no application server is involved.
 *
 * Rendering is deliberately not included: a DOM renderer is a page concern, and the shapes it
 * produces (how a table looks, whether HTML output is sandboxed) belong to the page, not the
 * library. See `examples/local-runner/run-app` for a complete one.
 */
export * from './index'
