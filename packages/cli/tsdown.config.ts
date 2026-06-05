import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

const currentDir = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  entry: ['src/bin.ts', 'src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  onSuccess() {
    const skillsSrc = path.resolve(currentDir, '../../skills/deepnote')
    const skillsDest = path.resolve(currentDir, 'dist/skills/deepnote')
    if (!fs.existsSync(skillsSrc)) {
      console.warn('Skills source directory not found, skipping copy:', skillsSrc)
      return
    }
    fs.cpSync(skillsSrc, skillsDest, { recursive: true })
  },
})
