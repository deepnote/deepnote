import path from 'node:path'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    server: {
      deps: {
        inline: ['@xterm/headless'],
      },
    },
    globals: false,
    include: ['**/*.test.ts'],
    reporters: ['default', 'junit'],
    outputFile: {
      junit: './coverage/test-results.xml',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts'],
    },
    setupFiles: [path.resolve(__dirname, 'test-helpers/expect-url-with-query-params.ts')],
    bail: 1,
  },
})
