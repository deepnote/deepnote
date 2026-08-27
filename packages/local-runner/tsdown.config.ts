import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      workflows: 'src/workflows/index.ts',
    },
    format: ['esm', 'cjs'],
    fixedExtension: false,
    dts: true,
    external: ['@deepnote/blocks', '@deepnote/cloud', '@deepnote/convert', '@deepnote/runtime-core', 'workflow'],
  },
  {
    // The browser build ships as one self-contained file that a static page can <script> in, so
    // its dependencies (the YAML parser, the block schemas, the cloud client) are bundled rather
    // than externalized. It carries both the snapshot reader and the client-only orchestrator,
    // which is why the same bundle is published under two names.
    entry: { 'snapshot-reader': 'src/browser-snapshot.ts' },
    format: ['iife'],
    platform: 'browser',
    globalName: 'DeepnoteSnapshot',
    dts: false,
    noExternal: [/.*/],
  },
  {
    // The client-only orchestrator: the same engine Node uses, bound to a fetch-based cloud runner.
    // Self-contained for the same reason as the snapshot reader — a static page <script>s it and
    // has no bundler of its own.
    entry: { orchestrator: 'src/browser.ts' },
    format: ['iife'],
    platform: 'browser',
    globalName: 'DeepnoteOrchestrator',
    dts: false,
    noExternal: [/.*/],
  },
])
