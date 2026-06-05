import { copyFileSync, mkdirSync } from 'node:fs'

mkdirSync('dist/scripts', { recursive: true })
copyFileSync('src/scripts/ast-analyzer.py', 'dist/scripts/ast-analyzer.py')
