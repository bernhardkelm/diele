import { describe, expect, it, vi } from 'vitest'
import { buildStations, featureKey } from '@/features/admin/adminStations'
import { rowActionsFor } from '@/features/admin/adminRowActions'
import { detailOf, summaryOf } from '@/features/admin/adminRowText'
import type { ApiFeature, ApiRow } from '@diele/common'
import type { ListAction } from '@/helpers/listActions'

/**
 * Builds a feature to place in the ring.
 * @param {Partial<ApiFeature>} overrides - Fields to set on top of a minimal feature
 * @returns {ApiFeature} - The feature
 */
function feature(overrides: Partial<ApiFeature> = {}): ApiFeature {
  return {
    id: 'cards',
    label: 'Cards',
    description: 'the logo cards',
    kind: 'builtin',
    produces: ['card'],
    fields: [],
    count: 0,
    enabledCount: 0,
    ...overrides,
  } as ApiFeature
}

/**
 * Builds a row of a feature.
 * @param {number} id - Row id
 * @param {Partial<ApiRow>} overrides - Fields to set on top of a minimal row
 * @returns {ApiRow} - The row
 */
function row(id: number, overrides: Partial<ApiRow> = {}): ApiRow {
  return { id, label: `Row ${id}`, url: `https://row-${id}.test`, ...overrides } as ApiRow
}

const leave: ListAction = {
  kind: 'action',
  id: 'leave',
  label: 'Back to the portal',
  description: 'leave',
  run: vi.fn(),
}

describe('buildStations', () => {
  it('places one station per feature, then the closing actions', () => {
    const stations = buildStations(
      [feature(), feature({ id: 'sites', label: 'Sites' })],
      undefined,
      [],
      [leave],
    )

    expect(stations.map((station) => station.kind)).toEqual(['feature', 'feature', 'action'])
    expect(stations[0]!.key).toBe(featureKey('cards'))
  })

  // Walking down from a feature steps into its entries rather than over them.
  it('puts the open feature rows directly under it', () => {
    const stations = buildStations(
      [feature(), feature({ id: 'sites', label: 'Sites' })],
      'cards',
      [row(1), row(2)],
      [],
    )

    expect(stations.map((station) => station.kind)).toEqual([
      'feature',
      'add',
      'entry',
      'entry',
      'feature',
    ])
  })

  // Adding is what a feature is opened for as often as not, and behind a long list it is a
  // scroll away from the row that was just opened.
  it('puts the add row ahead of the entries', () => {
    const stations = buildStations([feature()], 'cards', [row(1)], [])

    expect(stations[1]!.kind).toBe('add')
    expect(stations[1]!.label).toBe('Add entry')
  })

  it('marks the first and last entry, since reordering past them has nowhere to go', () => {
    const stations = buildStations([feature()], 'cards', [row(1), row(2), row(3)], [])
    const entries = stations.filter((station) => station.kind === 'entry')

    expect(entries.map((entry) => [entry.first, entry.last])).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ])
  })

  it('marks a lone entry as both ends at once', () => {
    const [entry] = buildStations([feature()], 'cards', [row(1)], []).filter(
      (station) => station.kind === 'entry',
    )

    expect(entry!.first).toBe(true)
    expect(entry!.last).toBe(true)
  })

  it('opens nothing for a feature that is unavailable or only a switch', () => {
    for (const overrides of [{ unavailable: 'not built yet' }, { switchOnly: true }]) {
      const stations = buildStations([feature(overrides)], 'cards', [row(1)], [])

      expect(
        stations.map((station) => station.kind),
        JSON.stringify(overrides),
      ).toEqual(['feature'])
    }
  })

  it('gives every station a key of its own', () => {
    const stations = buildStations(
      [feature(), feature({ id: 'sites' })],
      'cards',
      [row(1), row(2)],
      [leave],
    )
    const keys = stations.map((station) => station.key)

    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('rowActionsFor', () => {
  it('offers nothing when nothing holds focus', () => {
    expect(rowActionsFor(undefined)).toEqual([])
  })

  // A built-in row is shown but not owned by whoever is looking at it.
  it('offers nothing on a read-only row', () => {
    const [station] = buildStations([feature()], 'cards', [row(1, { readonly: true })], []).filter(
      (s) => s.kind === 'entry',
    )

    expect(rowActionsFor(station)).toEqual([])
  })

  it('offers edit, reorder, switch and delete on an ordinary row', () => {
    const [station] = buildStations([feature()], 'cards', [row(1), row(2)], []).filter(
      (s) => s.kind === 'entry',
    )

    expect(rowActionsFor(station).map((action) => action.id)).toEqual([
      'edit',
      'up',
      'down',
      'toggle',
      'remove',
    ])
  })

  it('disables the reorder that has nowhere to go', () => {
    const entries = buildStations([feature()], 'cards', [row(1), row(2)], []).filter(
      (s) => s.kind === 'entry',
    )

    const first = rowActionsFor(entries[0])
    expect(first.find((action) => action.id === 'up')?.disabled).toBe(true)
    expect(first.find((action) => action.id === 'down')?.disabled).toBe(false)
  })

  // Anything that fetches on a schedule can be asked to fetch now, which is what says whether
  // a token someone just entered works.
  it('offers a sync only where the feature fetches entries', () => {
    const fetching = buildStations(
      [feature({ capabilities: ['entries'] } as Partial<ApiFeature>)],
      'cards',
      [row(1)],
      [],
    ).filter((s) => s.kind === 'entry')

    expect(rowActionsFor(fetching[0]).map((action) => action.id)).toContain('sync')
  })

  // The word is the state it is in, not the state it would move to.
  it('names the switch after the state the row is in', () => {
    const on = buildStations([feature()], 'cards', [row(1, { enabled: true })], []).filter(
      (s) => s.kind === 'entry',
    )
    const off = buildStations([feature()], 'cards', [row(1, { enabled: false })], []).filter(
      (s) => s.kind === 'entry',
    )

    expect(rowActionsFor(on[0]).find((a) => a.id === 'toggle')).toMatchObject({ label: 'on' })
    expect(rowActionsFor(off[0]).find((a) => a.id === 'toggle')).toMatchObject({
      label: 'off',
      tone: 'off',
      persistent: true,
    })
  })

  it('offers only open on a feature that cannot be switched', () => {
    const [station] = buildStations([feature()], undefined, [], [])

    expect(rowActionsFor(station).map((action) => action.id)).toEqual(['open'])
  })

  it('offers open and the switch on a toggleable feature', () => {
    const [station] = buildStations(
      [feature({ toggleable: true, enabled: true })],
      undefined,
      [],
      [],
    )

    expect(rowActionsFor(station).map((action) => action.id)).toEqual(['open', 'toggle'])
  })

  // Nothing to open, so the switch is the row's own action rather than one beside it.
  it('offers only the switch on a feature that owns no rows', () => {
    const [station] = buildStations(
      [feature({ toggleable: true, switchOnly: true, enabled: true })],
      undefined,
      [],
      [],
    )

    expect(rowActionsFor(station).map((action) => action.id)).toEqual(['toggle'])
  })

  it('offers nothing on a feature that is not built yet', () => {
    const [station] = buildStations([feature({ unavailable: 'planned' })], undefined, [], [])

    expect(rowActionsFor(station)).toEqual([])
  })

  it('offers the add row its own edit action, and a disabled closing row none', () => {
    const stations = buildStations([feature()], 'cards', [], [{ ...leave, disabled: true }])

    expect(rowActionsFor(stations.find((s) => s.kind === 'add')).map((a) => a.id)).toEqual(['edit'])
    expect(rowActionsFor(stations.find((s) => s.kind === 'action'))).toEqual([])
  })
})

describe('the row texts', () => {
  it('writes a command keyword the way it is typed', () => {
    expect(summaryOf(row(1, { keyword: 'yt', label: 'YouTube' }))).toBe('/yt')
  })

  it('falls back through label and name', () => {
    expect(summaryOf(row(1, { label: 'Grafana' }))).toBe('Grafana')
    expect(summaryOf({ id: 1, name: 'Named' } as ApiRow)).toBe('Named')
    expect(summaryOf({ id: 1 } as ApiRow)).toBe('')
  })

  it('shows the url or the template as the second column', () => {
    expect(detailOf(row(1, { url: 'https://x.test' }))).toBe('https://x.test')
    expect(detailOf(row(1, { keyword: 'yt', urlTemplate: 'https://y.test/?q={query}' }))).toBe(
      'https://y.test/?q={query}',
    )
  })

  // The list keeps serving the entries of the last good run, so nothing else would say a
  // token had quietly expired.
  it('reports what a connector last run did, ahead of its url', () => {
    expect(detailOf(row(1, { sync: { lastError: '401 unauthorized' } } as Partial<ApiRow>))).toBe(
      'failing: 401 unauthorized',
    )
    expect(detailOf(row(1, { sync: { lastOkAt: null } } as Partial<ApiRow>))).toBe('never synced')
    expect(
      detailOf(
        row(1, { sync: { lastOkAt: '2026-01-01 00:00', entryCount: 12 } } as Partial<ApiRow>),
      ),
    ).toBe('12 entries, synced 2026-01-01 00:00')
  })

  it('reports a run that found nothing rather than leaving the count blank', () => {
    expect(detailOf(row(1, { sync: { lastOkAt: '2026-01-01 00:00' } } as Partial<ApiRow>))).toBe(
      '0 entries, synced 2026-01-01 00:00',
    )
  })
})
