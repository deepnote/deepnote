import type { DeepnoteBlock } from '@deepnote/blocks'
import { describe, expect, it } from 'vitest'
import {
  collectDependencies,
  findInstallCommands,
  normalizePackageName,
  type PackageRequirement,
  packageUrl,
  parseRequirement,
  reconcile,
} from './dependencies'

/** A requirement as `name specifier → pin`, which is everything the checks read. */
function parsed(input: string, installer?: string): string | undefined {
  const requirement = parseRequirement(input, { source: 'requirements', ...(installer ? { installer } : {}) })
  return requirement && `${requirement.name} ${requirement.specifier ?? '-'} → ${requirement.pin}`
}

function blocks(...contents: string[]): DeepnoteBlock[] {
  return contents.map((content, index) => ({ id: `b${index}`, type: 'code', content })) as unknown as DeepnoteBlock[]
}

describe('normalizePackageName', () => {
  it('folds the separators PEP 503 treats as equivalent', () => {
    expect(normalizePackageName('Scikit_Learn')).toBe('scikit-learn')
    expect(normalizePackageName('zope.interface')).toBe('zope-interface')
    expect(normalizePackageName('a__b--c')).toBe('a-b-c')
  })
})

describe('parseRequirement', () => {
  it('reads an exact pin', () => {
    expect(parsed('pandas==2.0.1')).toBe('pandas ==2.0.1 → pinned')
    expect(parsed('pandas===2.0.1')).toBe('pandas ===2.0.1 → pinned')
  })

  it('reads a range as ranged, not pinned', () => {
    expect(parsed('pandas>=2.0')).toBe('pandas >=2.0 → ranged')
    expect(parsed('pandas~=2.0')).toBe('pandas ~=2.0 → ranged')
    expect(parsed('pandas!=1.9')).toBe('pandas !=1.9 → ranged')
    expect(parsed('pandas>=2.0,<3')).toBe('pandas >=2.0,<3 → ranged')
  })

  it('reads a wildcard as a range, because it is one', () => {
    expect(parsed('pandas==2.*')).toBe('pandas ==2.* → ranged')
  })

  it('reads a bare name as unpinned', () => {
    expect(parsed('pandas')).toBe('pandas - → unpinned')
  })

  it('ignores extras and environment markers, which do not change the version', () => {
    expect(parsed('pandas[all]==2.0.1')).toBe('pandas ==2.0.1 → pinned')
    expect(parsed('pandas==2.0.1 ; python_version < "3.12"')).toBe('pandas ==2.0.1 → pinned')
  })

  it('ignores a trailing comment', () => {
    expect(parsed('pandas==2.0.1  # the one that works')).toBe('pandas ==2.0.1 → pinned')
  })

  it('is not a requirement: flags, includes and blank lines', () => {
    expect(parseRequirement('')).toBeUndefined()
    expect(parseRequirement('# a comment')).toBeUndefined()
    expect(parseRequirement('-r base.txt')).toBeUndefined()
    expect(parseRequirement('--index-url https://pypi.example.com')).toBeUndefined()
  })

  it('pins a VCS requirement only when it names a commit', () => {
    expect(parsed('git+https://github.com/pandas-dev/pandas@3f8a21c9d4e7b60')).toContain('→ pinned')
    expect(parsed('git+https://github.com/pandas-dev/pandas@main')).toContain('→ unpinned')
    expect(parsed('git+https://github.com/pandas-dev/pandas')).toContain('→ unpinned')
  })

  it('reads the name from a PEP 508 direct reference', () => {
    const requirement = parseRequirement('pandas @ https://example.com/pandas-2.0.1.whl')
    expect(requirement?.name).toBe('pandas')
    expect(requirement?.pin).toBe('unpinned')
  })

  it("reads conda's single-equals pin, which pip grammar would miss entirely", () => {
    expect(parsed('numpy=1.21', 'conda')).toBe('numpy ==1.21 → pinned')
    // The same string under pip is a name with no specifier the parser can use.
    expect(parsed('numpy=1.21', 'pip')).toBe('numpy =1.21 → ranged')
  })
})

describe('findInstallCommands', () => {
  it('reads a shell-escape pip install', () => {
    expect(findInstallCommands('!pip install pandas==2.0.1').map(r => r.name)).toEqual(['pandas'])
  })

  it('reads every spelling of the install line', () => {
    const lines = [
      '!pip install a',
      '%pip install b',
      '!pip3 install c',
      '!python -m pip install d',
      '!uv pip install e',
      '!conda install f',
      '%mamba install g',
      '!poetry add h',
    ]
    expect(findInstallCommands(lines.join('\n')).map(r => r.name)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
  })

  it('reads several packages from one command', () => {
    expect(findInstallCommands('!pip install pandas numpy==1.26 scipy>=1.11').map(r => `${r.name}:${r.pin}`)).toEqual([
      'pandas:unpinned',
      'numpy:pinned',
      'scipy:ranged',
    ])
  })

  it('honours quoting around a specifier', () => {
    expect(findInstallCommands('!pip install "pandas>=2.0,<3"').map(r => r.specifier)).toEqual(['>=2.0,<3'])
  })

  it('skips flags and the values they take', () => {
    expect(findInstallCommands('!pip install -q --upgrade -r reqs.txt pandas').map(r => r.name)).toEqual(['pandas'])
    expect(findInstallCommands('!pip install -i https://pypi.example.com pandas').map(r => r.name)).toEqual(['pandas'])
  })

  it('records the line the install sits on', () => {
    expect(findInstallCommands('import os\n\n!pip install pandas', 'b1')[0]).toMatchObject({ blockId: 'b1', line: 3 })
  })

  it('does not read a mention of pip install in prose or a string', () => {
    expect(findInstallCommands('# Run pip install pandas first')).toEqual([])
    expect(findInstallCommands('print("pip install pandas")')).toEqual([])
  })

  it('records which installer was used', () => {
    expect(findInstallCommands('!conda install numpy=1.21')[0]).toMatchObject({ installer: 'conda', pin: 'pinned' })
  })
})

describe('collectDependencies', () => {
  it('reads the resolved environment as pinned', () => {
    const set = collectDependencies({ packages: { pandas: '2.0.1', numpy: '1.26.0' } }, [])

    expect(set.requirements.map(r => `${r.name}@${r.version}`)).toEqual(['pandas@2.0.1', 'numpy@1.26.0'])
    expect(set.requirements.every(r => r.pin === 'pinned')).toBe(true)
    expect(set.hasEnvironment).toBe(true)
  })

  it('reads declared requirements and imperative installs together', () => {
    const set = collectDependencies(
      { packages: { pandas: '2.0.1' }, requirements: ['scipy>=1.11'] },
      blocks('!pip install seaborn')
    )

    expect(set.requirements.map(r => `${r.name}:${r.source}`)).toEqual([
      'pandas:environment',
      'scipy:requirements',
      'seaborn:install-command',
    ])
  })

  it('tracks only what the resolved environment holds', () => {
    const set = collectDependencies({ packages: { pandas: '2.0.1' } }, blocks('!pip install seaborn'))

    expect([...set.tracked]).toEqual(['pandas'])
  })

  it('reports no environment when none is declared', () => {
    expect(collectDependencies(undefined, blocks('!pip install pandas')).hasEnvironment).toBe(false)
    expect(collectDependencies({ requirements: ['pandas'] }, []).hasEnvironment).toBe(false)
  })

  it('does not read an install command out of a markdown block', () => {
    const prose = [{ id: 'm1', type: 'markdown', content: '!pip install pandas' }] as unknown as DeepnoteBlock[]
    expect(collectDependencies(undefined, prose).requirements).toEqual([])
  })
})

describe('reconcile', () => {
  it('folds one package declared twice into one entry', () => {
    const entries = reconcile([
      {
        name: 'pandas',
        rawName: 'pandas',
        version: '2.0.1',
        specifier: '==2.0.1',
        pin: 'pinned',
        source: 'environment',
      },
      {
        name: 'pandas',
        rawName: 'pandas',
        specifier: '>=2.0',
        pin: 'ranged',
        source: 'install-command',
        blockId: 'b1',
      },
    ])

    expect(entries).toHaveLength(1)
    expect(entries[0].sources).toEqual(['environment', 'install-command'])
  })

  it('keeps the weakest pin, because that is the one that decides reproducibility', () => {
    const entries = reconcile([
      {
        name: 'pandas',
        rawName: 'pandas',
        version: '2.0.1',
        specifier: '==2.0.1',
        pin: 'pinned',
        source: 'environment',
      },
      { name: 'pandas', rawName: 'pandas', pin: 'unpinned', source: 'install-command' },
    ])

    expect(entries[0].pin).toBe('unpinned')
    // The exact version is still reported: it is what was resolved, just not what was asked for.
    expect(entries[0].versions).toEqual(['2.0.1'])
  })

  it('collects every exact version seen', () => {
    const entries = reconcile([
      { name: 'pandas', rawName: 'pandas', version: '2.0.1', pin: 'pinned', source: 'environment' },
      { name: 'pandas', rawName: 'pandas', version: '1.5.0', pin: 'pinned', source: 'install-command' },
    ])

    expect(entries[0].versions).toEqual(['1.5.0', '2.0.1'])
  })

  it('sorts by normalized name, so two runs agree', () => {
    const entries = reconcile([
      { name: 'zope-interface', rawName: 'zope.interface', pin: 'unpinned', source: 'requirements' },
      { name: 'attrs', rawName: 'attrs', pin: 'unpinned', source: 'requirements' },
    ])

    expect(entries.map(entry => entry.name)).toEqual(['attrs', 'zope-interface'])
  })
})

describe('packageUrl', () => {
  it('builds the purl an SBOM consumer matches advisories against', () => {
    expect(packageUrl('pandas', '2.0.1')).toBe('pkg:pypi/pandas@2.0.1')
    expect(packageUrl('pandas')).toBe('pkg:pypi/pandas')
  })
})

describe('reconcile — what the lockfile settles', () => {
  const locked = (version: string): PackageRequirement => ({
    name: 'pandas',
    rawName: 'pandas',
    version,
    specifier: `==${version}`,
    pin: 'pinned',
    source: 'environment',
  })

  it('treats a locked package as pinned even when a requirement asks for a range', () => {
    // `environment.packages` is the resolved set. A looser `requirements` entry beside it is what
    // was asked for, not what arrives — firing here would be wrong on almost every synced project.
    const entries = reconcile([
      locked('2.0.1'),
      { name: 'pandas', rawName: 'pandas', specifier: '>=1.24', pin: 'ranged', source: 'requirements' },
    ])

    expect(entries[0].pin).toBe('pinned')
    expect(entries[0].weakestSource).toBeUndefined()
  })

  it('treats a locked package as pinned when a requirement names no version at all', () => {
    const entries = reconcile([
      locked('2.0.1'),
      { name: 'pandas', rawName: 'pandas', pin: 'unpinned', source: 'requirements' },
    ])

    expect(entries[0].pin).toBe('pinned')
  })

  it('does not let the lockfile cover a package a block re-installs', () => {
    // The install command runs after the environment is built, so it overrides the lock.
    const entries = reconcile([
      locked('2.0.1'),
      { name: 'pandas', rawName: 'pandas', pin: 'unpinned', source: 'install-command', blockId: 'b1', line: 2 },
    ])

    expect(entries[0].pin).toBe('unpinned')
    expect(entries[0].weakestSource).toBe('install-command')
    expect(entries[0].blockId).toBe('b1')
    // The resolved version is still reported: it is what the file says, which is why this is
    // worth a finding rather than being obvious.
    expect(entries[0].versions).toEqual(['2.0.1'])
  })

  it('leaves a locked package alone when the block re-installs it at the same exact version', () => {
    const entries = reconcile([
      locked('2.0.1'),
      {
        name: 'pandas',
        rawName: 'pandas',
        version: '2.0.1',
        specifier: '==2.0.1',
        pin: 'pinned',
        source: 'install-command',
        blockId: 'b1',
      },
    ])

    expect(entries[0].pin).toBe('pinned')
  })

  it('falls back to the weakest declaration when nothing is locked', () => {
    const entries = reconcile([
      { name: 'scipy', rawName: 'scipy', specifier: '~=1.11', pin: 'ranged', source: 'requirements' },
      { name: 'scipy', rawName: 'scipy', pin: 'unpinned', source: 'install-command', blockId: 'b2' },
    ])

    expect(entries[0].pin).toBe('unpinned')
    expect(entries[0].weakestSource).toBe('install-command')
  })

  it('names the declaration responsible, not the first one seen', () => {
    const entries = reconcile([
      {
        name: 'scipy',
        rawName: 'scipy',
        version: '1.11.0',
        specifier: '==1.11.0',
        pin: 'pinned',
        source: 'requirements',
      },
      { name: 'scipy', rawName: 'scipy', specifier: '>=1.11', pin: 'ranged', source: 'install-command', blockId: 'b2' },
    ])

    expect(entries[0].weakestSource).toBe('install-command')
    expect(entries[0].specifier).toBe('>=1.11')
  })
})

describe('findInstallCommands — shell continuations', () => {
  // `!pip install pandas && python train.py` installs one package, not three.
  it.each([
    ['&&', '!pip install pandas && python -m pytest'],
    ['; with no space', '!pip install pandas; echo done'],
    ['a pipe', '!pip install pandas | tee install.log'],
    ['a trailing comment', '!pip install pandas  # and numpy later'],
    ['a redirect', '!pip install pandas > install.log'],
    ['&& with no spaces', '!pip install pandas&&make'],
  ])('stops at %s', (_label, line) => {
    expect(findInstallCommands(line).map(r => r.name)).toEqual(['pandas'])
  })

  it('keeps every package before the terminator', () => {
    expect(findInstallCommands('!pip install pandas numpy && rm -rf build').map(r => r.name)).toEqual([
      'pandas',
      'numpy',
    ])
  })

  it('does not mistake a version specifier for a redirect', () => {
    expect(findInstallCommands('!pip install "pandas>=2.0,<3" numpy').map(r => r.name)).toEqual(['pandas', 'numpy'])
    expect(findInstallCommands('!pip install pandas>=2.0').map(r => r.specifier)).toEqual(['>=2.0'])
  })
})

describe('reconcile — the version a project actually ends up with', () => {
  it('prefers the install command, which runs after the environment is built', () => {
    const [entry] = reconcile([
      { name: 'pandas', rawName: 'pandas', version: '2.0.1', pin: 'pinned', source: 'environment' },
      { name: 'pandas', rawName: 'pandas', version: '1.5.0', pin: 'pinned', source: 'install-command', blockId: 'b1' },
    ])

    // `versions` is sorted, so taking its first element would report 1.5.0 by accident rather
    // than on purpose — and would report 2.0.1 if the numbers were the other way round.
    expect(entry.effectiveVersion).toBe('1.5.0')
    expect(entry.versions).toEqual(['1.5.0', '2.0.1'])
  })

  it('falls back to the lockfile when no block re-installs', () => {
    const [entry] = reconcile([
      { name: 'pandas', rawName: 'pandas', version: '2.0.1', pin: 'pinned', source: 'environment' },
      { name: 'pandas', rawName: 'pandas', specifier: '>=1.0', pin: 'ranged', source: 'requirements' },
    ])

    expect(entry.effectiveVersion).toBe('2.0.1')
  })

  it('has no effective version when nothing names one', () => {
    expect(
      reconcile([{ name: 'pandas', rawName: 'pandas', pin: 'unpinned', source: 'requirements' }])[0].effectiveVersion
    ).toBeUndefined()
  })
})
