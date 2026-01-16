import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/bin.ts', 'src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  external: ['@deepnote/blocks'],
})
