import { defineConfig } from 'tsdown'

export default defineConfig({
  // Two entry points: the browser-safe root and the Node-only filesystem helpers.
  entry: ['src/index.ts', 'src/node/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
})
