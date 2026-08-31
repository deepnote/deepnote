import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  fixedExtension: false,
  dts: true,
  external: ['@deepnote/blocks', '@deepnote/cloud', '@deepnote/runtime-core'],
})
