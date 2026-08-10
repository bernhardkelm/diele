import { describe, expect, it, vi } from 'vitest'
import { searchActions, type ListAction } from '@/helpers/listActions'

const actions: ReadonlyArray<ListAction> = [
  {
    kind: 'action',
    id: 'export',
    label: 'Export configuration',
    description: 'Download everything this portal renders as one file',
    run: vi.fn(),
  },
  {
    kind: 'action',
    id: 'import',
    label: 'Import configuration',
    description: 'Replace everything with a file from elsewhere',
    run: vi.fn(),
  },
  {
    kind: 'action',
    id: 'leave',
    label: 'Back to the portal',
    description: 'Close this view',
    run: vi.fn(),
  },
]

describe('searchActions', () => {
  it('offers every action for a blank query', () => {
    expect(searchActions(actions, '')).toEqual(actions)
    expect(searchActions(actions, '   ')).toEqual(actions)
  })

  it('finds an action by its label, its id and its description', () => {
    expect(searchActions(actions, 'export').map((action) => action.id)).toEqual(['export'])
    expect(searchActions(actions, 'leave').map((action) => action.id)).toEqual(['leave'])
    expect(searchActions(actions, 'download').map((action) => action.id)).toEqual(['export'])
  })

  it('narrows rather than widens as a query grows', () => {
    expect(searchActions(actions, 'configuration')).toHaveLength(2)
    expect(searchActions(actions, 'configuration export')).toHaveLength(1)
  })

  it('offers nothing when the term addresses none of them', () => {
    expect(searchActions(actions, 'zzzznothing')).toEqual([])
  })

  // They close the list, so a search must not float one of them above the rows it narrowed to.
  it('keeps the declared order rather than ranking by score', () => {
    const found = searchActions(actions, 'configuration')

    expect(found.map((action) => action.id)).toEqual(['export', 'import'])
  })

  it('leaves the list it was given alone', () => {
    const before = [...actions]
    searchActions(actions, 'export')

    expect(actions).toEqual(before)
  })
})
