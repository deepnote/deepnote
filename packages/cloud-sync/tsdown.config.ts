import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  fixedExtension: false,
  dts: true,
  external: ['@deepnote/blocks', '@deepnote/cloud', '@deepnote/database-integrations'],
  // p-map is ESM-only, and an external default import of it throws at call time in the CJS build, so it is
  // bundled and listed as a devDependency. The "not used in the bundle" hint comes from the dts pass.
  deps: { alwaysBundle: ['p-map'], onlyBundle: ['p-map'] },
})
