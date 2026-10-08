import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  fixedExtension: false,
  dts: true,
  external: ['@deepnote/cloud', '@deepnote/database-integrations'],
})
