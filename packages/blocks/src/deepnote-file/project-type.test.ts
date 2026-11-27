import { describe, expect, it } from 'vitest'

import { getProjectType, isSingleNotebookProjectType } from './project-type'

describe('getProjectType', () => {
  it.each(['standard', 'notebook', 'agent', 'data_app', 'streamlit_app'])(
    'returns %s for a project of that type',
    type => {
      expect(getProjectType({ type })).toBe(type)
    }
  )

  it.each([
    ['an absent', {}],
    ['an empty', { type: '' }],
    ['an unknown', { type: 'future_kind' }],
  ])('returns standard for %s type', (_, project) => {
    expect(getProjectType(project)).toBe('standard')
  })
})

describe('isSingleNotebookProjectType', () => {
  it.each([
    ['standard', false],
    ['notebook', true],
    ['agent', true],
    ['data_app', true],
    ['streamlit_app', true],
  ] as const)('%s is a single-notebook type: %s', (type, expected) => {
    expect(isSingleNotebookProjectType(type)).toBe(expected)
  })
})
