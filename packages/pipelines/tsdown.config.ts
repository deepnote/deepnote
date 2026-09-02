import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    fixedExtension: false,
    dts: true,
    external: ['@deepnote/blocks', '@deepnote/cloud'],
  },
  {
    // The bundle a static page `<script>`s in: the engine, the cloud executor, and the `.deepnote`
    // pipeline reader, self-contained because the page has no bundler of its own.
    entry: { browser: 'src/browser.ts' },
    format: ['iife'],
    platform: 'browser',
    globalName: 'DeepnotePipelines',
    dts: false,
    noExternal: [/.*/],
  },
])
