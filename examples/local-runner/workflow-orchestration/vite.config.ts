import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'
import { workflow } from 'workflow/vite'

export default defineConfig({
  plugins: [nitro(), workflow()],
  server: {
    host: '127.0.0.1',
  },
  nitro: {
    serverDir: './',
    // Treat this example as the Workflow SDK project boundary. Otherwise Nitro selects the pnpm
    // monorepo root and the step builder bundles every Deepnote workspace package (including the
    // CommonJS YAML parser) instead of loading @deepnote/local-runner as a Node dependency.
    workspaceDir: './',
  },
})
