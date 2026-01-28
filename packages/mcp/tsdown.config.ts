import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/bin.ts', 'src/index.ts', 'src/test-tool.ts'],
  format: ['esm', 'cjs'],
  dts: true,
})
