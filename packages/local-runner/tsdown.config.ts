import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
    },
    format: ['esm', 'cjs'],
    fixedExtension: false,
    dts: true,
    external: ['@deepnote/blocks', '@deepnote/cloud', '@deepnote/convert', '@deepnote/runtime-core'],
  },
  {
    // The browser build ships as one self-contained file that a static page can <script> in, so
    // its dependencies (the YAML parser, the block schemas) are bundled rather than externalized.
    // Narrower than the orchestrator bundle: a page that only renders a snapshot should not ship a
    // cloud client it never calls.
    entry: { 'snapshot-reader': 'src/browser-snapshot.ts' },
    format: ['iife'],
    platform: 'browser',
    globalName: 'DeepnoteSnapshot',
    dts: false,
    noExternal: [/.*/],
  },
  {
    // The orchestrator a static page <script>s in: the engine, the cloud executor, and the
    // `.deepnote` pipeline reader. Self-contained because the page has no bundler of its own.
    entry: { orchestrator: 'src/browser.ts' },
    format: ['iife'],
    platform: 'browser',
    globalName: 'DeepnoteOrchestrator',
    dts: false,
    noExternal: [/.*/],
  },
])
