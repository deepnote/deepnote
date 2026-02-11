import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'tsdown'

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
    const skillsSrc = path.resolve(__dirname, '../../skills/deepnote')
    const skillsDest = path.resolve(__dirname, 'dist/skills/deepnote')
    copyDirSync(skillsSrc, skillsDest)
  },
})
