import path from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * Integration tests start the real deepnote-toolkit server and kernel. They are excluded from
 * `pnpm test` and run with `pnpm test:integration`; point `DEEPNOTE_PYTHON` at an interpreter that
 * has `deepnote-toolkit[server]` installed (the default is `python3` on PATH).
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: false,
    include: ['**/*.integration.test.ts'],
    reporters: ['default'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
    setupFiles: [path.resolve(__dirname, 'test-helpers/expect-url-with-query-params.ts')],
  },
})
