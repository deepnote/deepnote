import { describe, expect, it } from 'vitest'
import { isSafeRelativeFilePath, planProjectPaths, sanitizePathSegment } from './sync-paths'

describe('sanitizePathSegment', () => {
  it('replaces characters no cross-platform filename can contain', () => {
    expect(sanitizePathSegment('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })

  it('strips trailing dots and spaces, which Windows would silently drop', () => {
    expect(sanitizePathSegment('report. . ')).toBe('report')
  })

  it('replaces an empty or dot-only name with a placeholder', () => {
    expect(sanitizePathSegment('')).toBe('_')
    expect(sanitizePathSegment('   ')).toBe('_')
    expect(sanitizePathSegment('..')).toBe('_')
  })

  it('prefixes Windows reserved device names', () => {
    expect(sanitizePathSegment('CON')).toBe('_CON')
    expect(sanitizePathSegment('com1')).toBe('_com1')
    expect(sanitizePathSegment('console')).toBe('console')
  })

  it('prefixes dot-paths reserved by sync and common tooling', () => {
    expect(sanitizePathSegment('.deepnote-sync.json')).toBe('_.deepnote-sync.json')
    expect(sanitizePathSegment('.files')).toBe('_.files')
    expect(sanitizePathSegment('.git')).toBe('_.git')
  })

  it('replaces control characters', () => {
    expect(sanitizePathSegment('a\tb\nc')).toBe('a_b_c')
  })

  it('truncates to the maximum segment length', () => {
    expect(sanitizePathSegment('a'.repeat(130))).toBe('a'.repeat(120))
  })

  it('strips a trailing dot or space exposed by truncation, which Windows would silently drop', () => {
    // The 120th character is the separator, so truncating to 120 would leave it trailing.
    expect(sanitizePathSegment(`${'a'.repeat(119)}.${'b'.repeat(10)}`)).toBe('a'.repeat(119))
    expect(sanitizePathSegment(`${'a'.repeat(119)} ${'b'.repeat(10)}`)).toBe('a'.repeat(119))
  })
})

describe('planProjectPaths', () => {
  it('mirrors the workspace folder tree as a sanitized directory per project', () => {
    const plans = planProjectPaths([
      {
        id: 'p1',
        name: 'Sales report',
        folder: { id: 'f-q1', path: [{ name: 'Team A' }, { name: 'Q1: Reports' }] },
      },
      { id: 'p2', name: 'Rootless', folder: null },
    ])

    expect(plans.get('p1')).toEqual({
      projectDir: 'Team A/Q1_ Reports/Sales report',
      filesDir: 'Team A/Q1_ Reports/Sales report/.files',
    })
    expect(plans.get('p2')).toEqual({ projectDir: 'Rootless', filesDir: 'Rootless/.files' })
  })

  it('namespaces an explicitly incomplete folder path by its stable folder id', () => {
    const plans = planProjectPaths([
      {
        id: 'p-incomplete',
        name: 'Weekly',
        folder: { id: 'hidden-reports', path: [{ name: 'Reports' }], isPathComplete: false },
      },
      {
        id: 'p-complete',
        name: 'Daily',
        folder: { id: 'root-reports', path: [{ name: 'Reports' }], isPathComplete: true },
      },
    ])

    expect(plans.get('p-incomplete')?.projectDir).toBe('.deepnote-incomplete/hidden-reports/Reports/Weekly')
    expect(plans.get('p-complete')?.projectDir).toBe('Reports/Daily')
  })

  it('suffixes every member of a collision group with its short id, so no project silently owns the clean name', () => {
    const plans = planProjectPaths([
      { id: 'aaaa1111-0000-0000-0000-000000000000', name: 'Report' },
      // Same path case-insensitively: macOS/Windows filesystems would conflate the two.
      { id: 'bbbb2222-0000-0000-0000-000000000000', name: 'REPORT' },
      { id: 'cccc3333-0000-0000-0000-000000000000', name: 'Unrelated' },
    ])

    expect(plans.get('aaaa1111-0000-0000-0000-000000000000')?.projectDir).toBe('Report (aaaa1111)')
    expect(plans.get('bbbb2222-0000-0000-0000-000000000000')?.projectDir).toBe('REPORT (bbbb2222)')
    expect(plans.get('cccc3333-0000-0000-0000-000000000000')?.projectDir).toBe('Unrelated')
  })

  it('reserves space for collision suffixes on maximum-length names', () => {
    const name = 'a'.repeat(120)
    const plans = planProjectPaths([
      { id: 'aaaaaaaa-project', name },
      { id: 'bbbbbbbb-project', name },
    ])

    expect(plans.get('aaaaaaaa-project')?.projectDir).toBe(`${'a'.repeat(109)} (aaaaaaaa)`)
    expect(plans.get('bbbbbbbb-project')?.projectDir).toBe(`${'a'.repeat(109)} (bbbbbbbb)`)
  })

  it('falls back to the full id when even short ids collide', () => {
    const plans = planProjectPaths([
      { id: 'aaaa1111-0000-0000-0000-000000000001', name: 'Report' },
      { id: 'aaaa1111-0000-0000-0000-000000000002', name: 'Report' },
    ])

    expect(plans.get('aaaa1111-0000-0000-0000-000000000001')?.projectDir).toBe(
      'Report (aaaa1111-0000-0000-0000-000000000001)'
    )
    expect(plans.get('aaaa1111-0000-0000-0000-000000000002')?.projectDir).toBe(
      'Report (aaaa1111-0000-0000-0000-000000000002)'
    )
  })

  it('produces the same plan regardless of input order', () => {
    const projects = [
      { id: 'p-b', name: 'Same' },
      { id: 'p-a', name: 'Same' },
      { id: 'p-c', name: 'Other' },
    ]

    const forward = planProjectPaths(projects)
    const reversed = planProjectPaths([...projects].reverse())

    expect(Object.fromEntries(reversed)).toEqual(Object.fromEntries(forward))
  })

  it('merges distinct cloud folders that share a name, and disambiguates projects that then collide', () => {
    // Two different folders both named "Reports" — their contents share one local directory.
    const plans = planProjectPaths([
      { id: 'p1', name: 'Weekly', folder: { id: 'f1', path: [{ name: 'Reports' }] } },
      { id: 'p2', name: 'Weekly', folder: { id: 'f2', path: [{ name: 'Reports' }] } },
    ])

    expect(plans.get('p1')?.projectDir).toBe('Reports/Weekly (p1)')
    expect(plans.get('p2')?.projectDir).toBe('Reports/Weekly (p2)')
  })

  it('disambiguates nested project directories', () => {
    const plans = planProjectPaths([
      { id: 'root0001-project', name: 'Team' },
      { id: 'child001-project', name: 'Report', folder: { id: 'f-team', path: [{ name: 'Team' }] } },
    ])

    expect(plans.get('root0001-project')?.projectDir).toBe('Team (root0001)')
    expect(plans.get('child001-project')?.projectDir).toBe('Team/Report (child001)')
  })

  it("keeps projects out of another project's .files subtree", () => {
    const plans = planProjectPaths([
      { id: 'root0001-project', name: 'Team' },
      { id: 'child001-project', name: '.files', folder: { id: 'f-team', path: [{ name: 'Team' }] } },
    ])

    expect(plans.get('root0001-project')?.projectDir).toBe('Team (root0001)')
    expect(plans.get('child001-project')?.projectDir).toBe('Team/_.files (child001)')
  })

  it('fails safely if hostile names exhaust the suffix fallbacks', () => {
    expect(() =>
      planProjectPaths([
        { id: 'aaaa1111-project-a', name: 'Report' },
        { id: 'aaaa1111-project-b', name: 'Report' },
        { id: 'occupier', name: 'Report (aaaa1111-project-a)' },
      ])
    ).toThrow(/disjoint local directories/)
  })
})

describe('isSafeRelativeFilePath', () => {
  it('accepts ordinary relative paths', () => {
    expect(isSafeRelativeFilePath('data/input.csv')).toBe(true)
    expect(isSafeRelativeFilePath('requirements.txt')).toBe(true)
  })

  it('rejects traversal, absolute, and backslash paths', () => {
    expect(isSafeRelativeFilePath('../escape.txt')).toBe(false)
    expect(isSafeRelativeFilePath('data/../../escape.txt')).toBe(false)
    expect(isSafeRelativeFilePath('/etc/passwd')).toBe(false)
    expect(isSafeRelativeFilePath('data\\input.csv')).toBe(false)
    expect(isSafeRelativeFilePath('data//input.csv')).toBe(false)
    expect(isSafeRelativeFilePath('./input.csv')).toBe(false)
  })
})
