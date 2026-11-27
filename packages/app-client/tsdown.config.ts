import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'

const modernScreenshotLicense = readFileSync(new URL('node_modules/modern-screenshot/LICENSE', import.meta.url), 'utf8')

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    fixedExtension: false,
    dts: true,
  },
  {
    entry: { v1: 'src/browser.ts' },
    format: ['iife'],
    platform: 'browser',
    target: 'es2020',
    minify: true,
    dts: false,
    deps: { onlyBundle: ['modern-screenshot'] },
    // The sources are ES modules, which always run in strict mode; an IIFE runs sloppy unless it says so.
    outputOptions: { strict: true },
    // modern-screenshot's MIT license requires its notice in every copy, and its own files carry none.
    banner: `/*!\n${modernScreenshotLicense}*/`,
  },
])
