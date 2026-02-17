import path from 'node:path'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: false,
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
    projects: [
      {
        extends: true,
        test: {
          name: 'packages',
          include: ['packages/*/src/**/*.test.ts'],
          exclude: ['packages/cli/**', '**/node_modules/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'cli',
          include: ['packages/cli/src/**/*.test.ts'],
          deps: {
            optimizer: {
              ssr: {
                enabled: true,
                include: ['@xterm/headless'],
              },
            },
          },
        },
      },
    ],
  },
})
