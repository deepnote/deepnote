import { defineConfig } from 'tsdown'

export default defineConfig({
  // Single browser-safe entry point. Filesystem/`process` wrappers are the
  // consumer's responsibility (e.g. the CLI, or the VS Code extension host).
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
})
