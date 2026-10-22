import { describe, expect, it, vi } from 'vitest'
import { historySection, type HistoryControls } from '@/features/settings/historySection'
import { searchSections, type SettingsItem } from '@/features/settings/settingsSections'
import { buildSettingsStations } from '@/features/settings/settingsStations'
import type { ListAction } from '@/helpers/listActions'
import type { ApiHistoryEntry } from '@diele/common'

const PAGE: ApiHistoryEntry = {
  id: 1,
  url: 'https://github.com/example/diele',
  title: 'diele',
  visits: 3,
  lastVisitedAt: '2026-10-01T00:00:00Z',
}

const UNTITLED: ApiHistoryEntry = {
  id: 2,
  url: 'https://old.example/notes',
  visits: 1,
  lastVisitedAt: '2026-09-01T00:00:00Z',
}

/**
 * Builds the controls a section is made from, on top of an opted-in account with two pages kept.
 * @param {Partial<HistoryControls>} overrides - What to vary
 * @returns {HistoryControls} - The controls
 */
function controls(overrides: Partial<HistoryControls> = {}): HistoryControls {
  return {
    state: {
      available: true,
      sources: { diele: true, extension: false },
      enabled: true,
      excludedDomains: ['bank.example'],
    },
    kept: [PAGE, UNTITLED],
    keptStatus: 'read',
    setEnabled: vi.fn(),
    exclude: vi.fn(() => Promise.resolve(undefined)),
    include: vi.fn(() => Promise.resolve()),
    remove: vi.fn(() => Promise.resolve()),
    clear: vi.fn(() => Promise.resolve()),
    ...overrides,
  }
}

/**
 * Returns the clearing row of a section.
 * @param {HistoryControls} given - Controls the section is built from
 * @returns {ListAction} - Its clearing row
 */
function clearRow(given: HistoryControls): ListAction {
  return historySection(given).rows!.find((row) => row.kind === 'action') as ListAction
}

/**
 * Returns the item rows of a section.
 * @param {HistoryControls} given - Controls the section is built from
 * @returns {ReadonlyArray<SettingsItem>} - Its items, in order
 */
function itemsOf(given: HistoryControls): ReadonlyArray<SettingsItem> {
  return historySection(given).rows!.filter((row) => row.kind === 'item') as SettingsItem[]
}

describe('historySection', () => {
  // The opt-in first, then adding to the excluded domains ahead of them, then the clearing row
  // ahead of the pages, the way a restore row leads what it restores.
  it('lists the opt-in, the excluded domains, the clearing row and the pages, in that order', () => {
    const section = historySection(controls())

    expect(section.options.map((option) => option.id)).toEqual(['enabled'])
    expect(section.rows!.map((row) => `${row.kind}:${row.id}`)).toEqual([
      'field:exclude',
      'item:domain:bank.example',
      'action:clear-history',
      'item:page:1',
      'item:page:2',
    ])
  })

  it('flips the opt-in the way it stands', () => {
    const given = controls()

    historySection(given).options[0]!.run()

    expect(given.setEnabled).toHaveBeenCalledWith(false)
    expect(historySection(given).trail).toBe('on')
  })

  // Opting out never deletes, so the off state has to say where what is kept can be forgotten.
  it('says while off that what is kept stays, and where to forget it', () => {
    const off = controls({ state: { ...controls().state, enabled: false } })
    const section = historySection(off)

    expect(section.trail).toBe('off')
    expect(section.options[0]!.on).toBe(false)
    expect(section.options[0]!.detail).toMatch(/stays until you forget it below/)
    expect(clearRow(off).description).toBe('forgets the 2 pages still kept from before')
    expect(itemsOf(off).filter((item) => item.id.startsWith('page:'))).toHaveLength(2)
  })

  it('says in the copy that excluding a domain forgets what is kept on it', () => {
    const field = historySection(controls()).rows![0]!

    expect(field.kind).toBe('field')
    expect(field.label).toBe('Exclude a domain')
    expect(field.kind === 'field' && field.detail).toMatch(/forgets what is already kept there/)
  })

  describe('the clearing row', () => {
    it('asks before forgetting everything', () => {
      const row = clearRow(controls())

      expect(row.confirm).toBe('press again to forget all')
      expect(row.disabled).toBeUndefined()
    })

    it('says nothing is kept, and does nothing, once nothing is', () => {
      const row = clearRow(controls({ kept: [] }))

      expect(row.description).toBe('nothing is kept for you')
      expect(row.disabled).toBe(true)
      expect(row.confirm).toBeUndefined()
    })

    it('says it is still reading, and that a read failed, rather than that nothing is kept', () => {
      expect(clearRow(controls({ kept: [], keptStatus: 'reading' })).description).toBe(
        'reading what is kept',
      )
      expect(clearRow(controls({ kept: [], keptStatus: 'failed' })).description).toMatch(
        /could not read/,
      )
    })
  })

  describe('a kept page', () => {
    // A page names itself, so the address beside the title is what tells a lookalike apart.
    it('reads as its title with its address and visits beside it', () => {
      const [, page] = itemsOf(controls())

      expect(page).toMatchObject({
        label: 'diele',
        detail: 'github.com/example/diele · 3 visits',
        removeTitle: 'Forget diele',
        confirm: true,
      })
      expect(page!.note).toMatch(/ago$/)
    })

    it('reads as its address where it has no title', () => {
      const untitled = itemsOf(controls()).at(-1)!

      expect(untitled.label).toBe('old.example/notes')
      expect(untitled.detail).toBe('1 visit')
    })

    it('forgets itself by id', async () => {
      const given = controls()

      await itemsOf(given)[1]!.remove()

      expect(given.remove).toHaveBeenCalledWith(1)
    })
  })

  it('takes an excluded domain off the list without asking first', async () => {
    const given = controls()
    const [domain] = itemsOf(given)

    expect(domain!.confirm).toBeUndefined()
    await domain!.remove()

    expect(given.include).toHaveBeenCalledWith('bank.example')
  })
})

describe('searching an open history section', () => {
  // The field and the clearing row act on the whole section, so a term narrowing it to one page
  // must not take away the way to add another or to forget them all.
  it('narrows the pages and domains, and keeps the field and the clearing row', () => {
    const [section] = searchSections([historySection(controls())], 'github', 'history')

    expect(section!.rows!.map((row) => row.id)).toEqual(['exclude', 'clear-history', 'page:1'])
  })

  it('finds the section itself by what it does', () => {
    const found = searchSections([historySection(controls())], 'visited', undefined)

    expect(found.map((section) => section.id)).toEqual(['history'])
  })
})

describe('the history section in the ring', () => {
  it('follows its options with one station per row, keyed by kind', () => {
    const stations = buildSettingsStations([historySection(controls())], 'history', [])

    expect(stations.map((station) => station.kind)).toEqual([
      'section',
      'option',
      'field',
      'item',
      'action',
      'item',
      'item',
    ])
    expect(stations.map((station) => station.key)).toContain('item:history:page:1')
  })

  it('lists none of them while the section is closed', () => {
    const stations = buildSettingsStations([historySection(controls())], undefined, [])

    expect(stations.map((station) => station.kind)).toEqual(['section'])
  })
})
