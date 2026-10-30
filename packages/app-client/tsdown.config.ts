import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    fixedExtension: false,
    dts: true,
  },
  {
    // One self-contained file a plain HTML app can <script> in and publish alongside itself.
    entry: { 'app-client': 'src/index.ts' },
    format: ['iife'],
    platform: 'browser',
    globalName: 'DeepnoteApp',
    // Minified: smaller to publish with an app, and free of the comments a build scan would read.
    minify: true,
    dts: false,
  },
])
