import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
    },
    format: ['esm', 'cjs'],
    fixedExtension: false,
    dts: true,
    external: [
      '@deepnote/blocks',
      '@deepnote/cloud',
      '@deepnote/convert',
      '@deepnote/pipelines',
      '@deepnote/runtime-core',
    ],
  },
  {
    // The browser build ships as one self-contained file that a static page can <script> in, so
    // its dependencies (the YAML parser, the block schemas) are bundled rather than externalized.
    // Narrower than `@deepnote/pipelines/browser`: a page that only renders an already-run snapshot
    // should not ship a cloud client it never calls.
    entry: { 'snapshot-reader': 'src/browser-snapshot.ts' },
    format: ['iife'],
    platform: 'browser',
    globalName: 'DeepnoteSnapshot',
    dts: false,
    noExternal: [/.*/],
  },
])
