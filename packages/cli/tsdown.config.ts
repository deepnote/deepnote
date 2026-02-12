import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

const currentDir =
  typeof __dirname !== 'undefined'
    ? __dirname
    : // @ts-expect-error: Safe ESM fallback; import.meta.url is only evaluated in ESM where __dirname is undefined.
      path.dirname(fileURLToPath(import.meta.url))

function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

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
    copyDirSync(skillsSrc, skillsDest)
  },
})
