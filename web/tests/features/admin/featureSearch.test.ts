import { describe, expect, it } from 'vitest'
import { searchFeatures } from '@/features/admin/featureSearch'
import { hintsFor } from '@/features/admin/adminHints'
import type { AdminStation } from '@/features/admin/adminStations'
import type { RowAction } from '@/features/admin/adminRowActions'
import type { ApiFeature } from '@diele/common'

/**
 * Builds a feature to search over.
 * @param {Partial<ApiFeature>} overrides - Fields to set on top of a minimal feature
 * @returns {ApiFeature} - The feature
 */
function feature(overrides: Partial<ApiFeature>): ApiFeature {
  return {
    id: 'cards',
    label: 'Cards',
    description: 'the logo cards on the resting page',
    kind: 'builtin',
    produces: ['card'],
    fields: [],
    count: 0,
    enabledCount: 0,
    ...overrides,
  } as ApiFeature
}

const features: ReadonlyArray<ApiFeature> = [
  feature({ id: 'commands', label: 'Slash commands', description: 'typed as /keyword' }),
  feature({ id: 'engines', label: 'Search engines', description: 'what Enter submits to' }),
  feature({ id: 'cards', label: 'Cards', description: 'the logo cards on the resting page' }),
]

describe('searchFeatures', () => {
  it('hands everything back in source order for a blank term', () => {
    expect(searchFeatures(features, '')).toBe(features)
    expect(searchFeatures(features, '  ')).toBe(features)
  })

  it('finds a feature by its label and its id', () => {
    expect(searchFeatures(features, 'engines').map((f) => f.id)).toEqual(['engines'])
    expect(searchFeatures(features, 'commands').map((f) => f.id)).toEqual(['commands'])
  })

  it('finds a feature by its prose', () => {
    expect(searchFeatures(features, 'keyword').map((f) => f.id)).toEqual(['commands'])
  })

  // A hit on the name outranks one on the prose, so typing a feature's name puts it first.
  it('ranks a name hit above a description hit', () => {
    const found = searchFeatures(features, 'cards')

    expect(found[0]!.id).toBe('cards')
  })

  it('narrows rather than widens as a second word is typed', () => {
    expect(searchFeatures(features, 'search').length).toBeGreaterThan(0)
    expect(searchFeatures(features, 'search engineszz')).toEqual([])
  })

  it('offers nothing for a term that addresses none of them', () => {
    expect(searchFeatures(features, 'zzznothing')).toEqual([])
  })

  it('searches the field labels a feature declares', () => {
    const withFields = [
      feature({
        id: 'x',
        label: 'X',
        fields: [{ key: 'urlTemplate', label: 'Query URL', input: 'template' }],
      }),
    ]

    expect(searchFeatures(withFields as ApiFeature[], 'query url')).toHaveLength(1)
  })
})

/**
 * Reads the hint texts for a station.
 * @param {AdminStation | undefined} station - Station holding focus
 * @param {ReadonlyArray<RowAction>} actions - What it offers
 * @param {boolean} expanded - Whether a feature station is open
 * @param {boolean} switchOnly - Whether the feature owns no rows
 * @returns {string[]} - Hint texts, in order
 */
function hints(
  station: AdminStation | undefined,
  actions: ReadonlyArray<RowAction> = [],
  expanded = false,
  switchOnly = false,
): string[] {
  return hintsFor(station, actions, expanded, switchOnly).map((hint) => hint.text)
}

const featureStation = {
  kind: 'feature',
  key: 'feature:cards',
  label: 'Cards',
  feature: feature({}),
} as AdminStation

const entryStation = {
  kind: 'entry',
  key: 'entry:cards:1',
  label: 'Row',
  feature: feature({}),
  row: { id: 1 },
  first: false,
  last: false,
} as AdminStation

describe('hintsFor', () => {
  it('names the field keys while nothing in the list holds focus', () => {
    expect(hints(undefined)).toEqual(['↑↓ selects', '↵ opens', 'esc leaves'])
  })

  it('says whether Enter opens or closes a feature', () => {
    expect(hints(featureStation, [], false)).toContain('↵ opens')
    expect(hints(featureStation, [], true)).toContain('↵ closes')
  })

  it('says Enter switches a feature that owns no rows', () => {
    expect(hints(featureStation, [{ id: 'toggle', label: 'on' }], false, true)).toContain(
      '↵ turns it on/off',
    )
  })

  // Naming a key that does nothing is worse than naming none, since the only way to find out
  // is to press it.
  it('leaves out the edit hint on a row that cannot be edited', () => {
    expect(hints(entryStation, [])).toEqual(['esc leaves'])
    expect(hints(entryStation, [{ id: 'edit', label: '' }])).toContain('↵ edits')
  })

  it('names the switch key only where there is a switch', () => {
    expect(hints(entryStation, [{ id: 'toggle', label: 'on' }])).toContain('d on/off')
    expect(hints(entryStation, [{ id: 'edit', label: '' }])).not.toContain('d on/off')
  })

  // The same key asks a connector to sync and a bound entry to probe, so the hint says which.
  it('names the fetch key by the word the row uses for it', () => {
    expect(hints(entryStation, [{ id: 'sync', label: 'sync' }])).toContain('s syncs')
    expect(hints(entryStation, [{ id: 'sync', label: 'probe' }])).toContain('s probes')
    expect(
      hints(entryStation, [{ id: 'edit', label: '' }]).some((text) => text.startsWith('s ')),
    ).toBe(false)
  })

  // Only where there is somewhere to move to: a list of one, or an end of it, has neither.
  it('names the reorder keys only where a move is possible', () => {
    const stuck: ReadonlyArray<RowAction> = [
      { id: 'up', label: '▾', disabled: true },
      { id: 'down', label: '▾', disabled: true },
    ]
    const movable: ReadonlyArray<RowAction> = [
      { id: 'up', label: '▾', disabled: true },
      { id: 'down', label: '▾' },
    ]

    expect(hints(entryStation, stuck)).not.toContain('alt+↑↓ reorders')
    expect(hints(entryStation, movable)).toContain('alt+↑↓ reorders')
  })

  it('names the delete key only where there is a delete', () => {
    expect(hints(entryStation, [{ id: 'remove', label: 'del' }])).toContain('x deletes')
    expect(hints(entryStation, [{ id: 'edit', label: '' }])).not.toContain('x deletes')
  })

  it('names the action keys only where more than one action can run', () => {
    const one: ReadonlyArray<RowAction> = [{ id: 'edit', label: '' }]
    const two: ReadonlyArray<RowAction> = [
      { id: 'edit', label: '' },
      { id: 'remove', label: 'del' },
    ]

    expect(hints(entryStation, one)).not.toContain('←→ picks an action')
    expect(hints(entryStation, two)).toContain('←→ picks an action')
  })

  it('always ends with the way out', () => {
    for (const station of [featureStation, entryStation]) {
      expect(hints(station, [{ id: 'edit', label: '' }]).at(-1)).toBe('esc leaves')
    }
  })

  it('names what Enter does on the add and action rows', () => {
    expect(
      hints({
        kind: 'add',
        key: 'add:cards',
        label: 'Add entry',
        feature: feature({}),
      } as AdminStation),
    ).toContain('↵ adds an entry')
    expect(
      hints({
        kind: 'action',
        key: 'action:leave',
        label: 'Leave',
        action: { id: 'leave' },
      } as AdminStation),
    ).toContain('↵ runs')
  })
})
