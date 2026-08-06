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

  it('replaces control characters', () => {
    expect(sanitizePathSegment('a\tb\nc')).toBe('a_b_c')
  })
})

describe('planProjectPaths', () => {
  it('mirrors the workspace folder tree as a sanitized directory per project', () => {
    const plans = planProjectPaths([
      { id: 'p1', name: 'Sales report', folder: { path: [{ name: 'Team A' }, { name: 'Q1: Reports' }] } },
      { id: 'p2', name: 'Rootless', folder: null },
    ])

    expect(plans.get('p1')).toEqual({
      projectDir: 'Team A/Q1_ Reports/Sales report',
      filesDir: 'Team A/Q1_ Reports/Sales report/.files',
    })
    expect(plans.get('p2')).toEqual({ projectDir: 'Rootless', filesDir: 'Rootless/.files' })
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
      { id: 'p1', name: 'Weekly', folder: { path: [{ name: 'Reports' }] } },
      { id: 'p2', name: 'Weekly', folder: { path: [{ name: 'Reports' }] } },
    ])

    expect(plans.get('p1')?.projectDir).toBe('Reports/Weekly (p1)')
    expect(plans.get('p2')?.projectDir).toBe('Reports/Weekly (p2)')
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
