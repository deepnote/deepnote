#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { ZodError } from 'zod'
import { deepnoteFileSchema } from './packages/blocks/src/deserialize-file/deepnote-file-schema.js'
import { parseYaml } from './packages/blocks/src/deserialize-file/parse-yaml.js'

/**
 * Recursively find all .deepnote files in a directory
 */
function findDeepnoteFiles(dir: string): string[] {
  const files: string[] = []
  const entries = readdirSync(dir)

  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)

    if (stat.isDirectory()) {
      // Skip node_modules and hidden directories
      if (entry === 'node_modules' || entry.startsWith('.')) {
        continue
      }
      files.push(...findDeepnoteFiles(fullPath))
    } else if (entry.endsWith('.deepnote')) {
      files.push(fullPath)
    }
  }

  return files
}

/**
 * Validate a single .deepnote file
 */
function validateDeepnoteFile(filePath: string): { valid: boolean; error?: string } {
  try {
    // Read and parse the YAML file
    const content = readFileSync(filePath, 'utf-8')
    const parsed = parseYaml(content)

    // Validate against the schema
    deepnoteFileSchema.parse(parsed)

    return { valid: true }
  } catch (error) {
    if (error && typeof error === 'object' && 'issues' in error) {
      // ZodError
      const zodError = error as ZodError
      const issues = zodError.issues.map((issue: { path: (string | number)[]; message: string }) => {
        const path = issue.path.join('.')
        return `  - ${path}: ${issue.message}`
      })
      return {
        valid: false,
        error: `Schema validation failed:\n${issues.join('\n')}`,
      }
    }
    if (error instanceof Error) {
      return { valid: false, error: error.message }
    }
    return { valid: false, error: String(error) }
  }
}

/**
 * Main validation function
 */
function main() {
  const rootDir = process.cwd()
  // biome-ignore lint/suspicious/noConsole: This is a CLI script
  console.log('🔍 Searching for .deepnote files...\n')

  const deepnoteFiles = findDeepnoteFiles(rootDir)

  if (deepnoteFiles.length === 0) {
    // biome-ignore lint/suspicious/noConsole: This is a CLI script
    console.log('⚠️  No .deepnote files found')
    process.exit(0)
  }

  // biome-ignore lint/suspicious/noConsole: This is a CLI script
  console.log(`Found ${deepnoteFiles.length} .deepnote file(s):\n`)

  let allValid = true
  const results: Array<{ file: string; valid: boolean; error?: string }> = []

  for (const file of deepnoteFiles) {
    const relativePath = relative(rootDir, file)
    const result = validateDeepnoteFile(file)
    results.push({ file: relativePath, ...result })

    if (result.valid) {
      // biome-ignore lint/suspicious/noConsole: This is a CLI script
      console.log(`✅ ${relativePath}`)
    } else {
      // biome-ignore lint/suspicious/noConsole: This is a CLI script
      console.log(`❌ ${relativePath}`)
      // biome-ignore lint/suspicious/noConsole: This is a CLI script
      console.log(`   ${result.error}\n`)
      allValid = false
    }
  }

  // biome-ignore lint/suspicious/noConsole: This is a CLI script
  console.log(`\n${'='.repeat(60)}`)
  if (allValid) {
    // biome-ignore lint/suspicious/noConsole: This is a CLI script
    console.log(`✅ All ${deepnoteFiles.length} .deepnote file(s) are valid!`)
    process.exit(0)
  } else {
    const failedCount = results.filter(r => !r.valid).length
    // biome-ignore lint/suspicious/noConsole: This is a CLI script
    console.log(`❌ ${failedCount} of ${deepnoteFiles.length} .deepnote file(s) failed validation`)
    process.exit(1)
  }
}

main()
