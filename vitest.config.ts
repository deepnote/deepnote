import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    include: ['packages/**/*.test.ts'],
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
    bail: 1,
  },
})
