import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const RUNTIME_DEPENDENCY_FIELDS = ['dependencies', 'peerDependencies', 'optionalDependencies'] as const

type Manifest = { name: string; private?: boolean } & Partial<
  Record<(typeof RUNTIME_DEPENDENCY_FIELDS)[number] | 'devDependencies', Record<string, string>>
>

function findPrivateRuntimeDependencies(manifests: Manifest[]): string[] {
  const privateNames = new Set(manifests.filter(manifest => manifest.private).map(manifest => manifest.name))
  return manifests.flatMap(manifest =>
    RUNTIME_DEPENDENCY_FIELDS.flatMap(field =>
      Object.keys(manifest[field] ?? {})
        .filter(name => privateNames.has(name))
        .map(name => `${manifest.name} lists ${name} in ${field}`)
    )
  )
}

function readWorkspaceManifests(): Manifest[] {
  const packagesDir = path.join(__dirname, '../..')
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(packagesDir, entry.name, 'package.json'))
    .filter(manifestPath => fs.existsSync(manifestPath))
    .map(manifestPath => JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Manifest)
}

describe('findPrivateRuntimeDependencies', () => {
  const internal: Manifest = { name: '@acme/internal', private: true }
  const published: Manifest = { name: '@acme/published' }

  it.each(['dependencies', 'peerDependencies', 'optionalDependencies'] as const)(
    'reports a private package listed in %s',
    field => {
      const consumer: Manifest = { name: '@acme/consumer', [field]: { '@acme/internal': 'workspace:*' } }

      expect(findPrivateRuntimeDependencies([internal, consumer])).toEqual([
        `@acme/consumer lists @acme/internal in ${field}`,
      ])
    }
  )

  it('allows a private package in devDependencies', () => {
    const consumer: Manifest = { name: '@acme/consumer', devDependencies: { '@acme/internal': 'workspace:*' } }

    expect(findPrivateRuntimeDependencies([internal, consumer])).toEqual([])
  })

  it('ignores runtime dependencies on packages that are not private', () => {
    const consumer: Manifest = {
      name: '@acme/consumer',
      dependencies: { '@acme/published': 'workspace:*', zod: '1.0.0' },
    }

    expect(findPrivateRuntimeDependencies([published, consumer])).toEqual([])
  })
})

describe('workspace packages', () => {
  it('never list a private package as a runtime dependency', () => {
    const manifests = readWorkspaceManifests()

    expect(manifests.filter(manifest => manifest.private).map(manifest => manifest.name)).toContain('@deepnote/common')
    expect(findPrivateRuntimeDependencies(manifests)).toEqual([])
  })
})
