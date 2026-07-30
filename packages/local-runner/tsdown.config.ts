import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    external: ['@deepnote/blocks', '@deepnote/cloud', '@deepnote/convert', '@deepnote/runtime-core'],
  },
  {
    // The snapshot reader ships as one self-contained file that a static page can <script> in, so
    // its dependencies (the YAML parser, the block schemas) are bundled rather than externalized.
    entry: { 'snapshot-reader': 'src/browser.ts' },
    format: ['iife'],
    platform: 'browser',
    globalName: 'DeepnoteSnapshot',
    dts: false,
    noExternal: [/.*/],
  },
])
