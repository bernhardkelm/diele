import { describe, expect, it, vi } from 'vitest'
import { historySection, type HistoryControls } from '@/features/settings/historySection'
import {
  searchSections,
  type SettingsItem,
  type SettingsPagedItems,
} from '@/features/settings/settingsSections'
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
      kept: 2,
    },
    kept: [PAGE, UNTITLED],
    keptStatus: 'read',
    shown: 100,
    showMore: vi.fn(),
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
 * Returns the item rows of a section, the paged kept pages included.
 * @param {HistoryControls} given - Controls the section is built from
 * @returns {ReadonlyArray<SettingsItem>} - Its items, in order
 */
function itemsOf(given: HistoryControls): ReadonlyArray<SettingsItem> {
  return historySection(given).rows!.flatMap((row) => {
    if (row.kind === 'paged') {
      return row.items
    }

    return row.kind === 'item' ? [row] : []
  })
}

/**
 * Returns the paged run of kept pages of a section.
 * @param {HistoryControls} given - Controls the section is built from
 * @returns {SettingsPagedItems} - Its kept pages
 */
function pagesOf(given: HistoryControls): SettingsPagedItems {
  return historySection(given).rows!.find((row) => row.kind === 'paged') as SettingsPagedItems
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
      'paged:pages',
    ])
    expect(pagesOf(controls()).items.map((item) => item.id)).toEqual(['page:1', 'page:2'])
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

  it('says while on where kept pages come from, which is the sources the portal accepts', () => {
    const detailFor = (diele: boolean, extension: boolean): string | undefined =>
      historySection(controls({ state: { ...controls().state, sources: { diele, extension } } }))
        .options[0]!.detail

    expect(detailFor(true, false)).toMatch(/^pages opened from the portal are kept/)
    expect(detailFor(false, true)).toMatch(/^pages the diele extension sends/)
    expect(detailFor(true, true)).toMatch(/portal, and those the diele extension sends/)
    expect(detailFor(false, false)).toMatch(/accepts visits from nowhere yet/)
  })

  it('says in the copy that excluding a domain forgets what is kept on it', () => {
    const field = historySection(controls()).rows![0]!

    expect(field).toMatchObject({ kind: 'field', label: 'Exclude a domain' })
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
  it('names in its description the sources the portal accepts', () => {
    const describedFor = (diele: boolean, extension: boolean): string =>
      historySection(controls({ state: { ...controls().state, sources: { diele, extension } } }))
        .description

    expect(describedFor(true, false)).toMatch(/^pages opened from the portal, kept/)
    expect(describedFor(false, true)).toMatch(/^pages sent by the diele extension/)
    expect(describedFor(true, true)).toMatch(
      /opened from the portal or sent by the diele extension/,
    )
    expect(describedFor(false, false)).toMatch(/accepts them from nowhere yet/)
  })

  // The api still serves and deletes what was kept, so it stays reachable for forgetting.
  describe('once the portal no longer offers history', () => {
    const off = (): HistoryControls =>
      controls({ state: { ...controls().state, available: false, enabled: true } })

    it('holds only the clearing row and the kept pages', () => {
      const section = historySection(off())

      expect(section.options).toEqual([])
      expect(section.rows!.map((row) => `${row.kind}:${row.id}`)).toEqual([
        'action:clear-history',
        'paged:pages',
      ])
      expect(section.trail).toBe('off')
      expect(section.description).toMatch(/no longer keeps history/)
    })

    it('says the pages are still kept from before, whatever the opt-in said', () => {
      expect(clearRow(off()).description).toBe('forgets the 2 pages still kept from before')
    })
  })

  describe('a long history', () => {
    const many: ApiHistoryEntry[] = Array.from({ length: 250 }, (_, index) => ({
      ...PAGE,
      id: index + 1,
      url: `https://site${index + 1}.example/`,
      title: `page ${index + 1}`,
    }))

    /**
     * Returns the keys of the stations a section occupies while open.
     * @param {HistoryControls} given - Controls the section is built from
     * @param {string} [query] - Term typed into the filter bar
     * @returns {ReadonlyArray<string>} - Station keys, in ring order
     */
    function keysOf(given: HistoryControls, query = ''): ReadonlyArray<string> {
      const sections = searchSections([historySection(given)], query, 'history')

      return buildSettingsStations(sections, 'history', []).map((station) => station.key)
    }

    it('lists the first page of them in the ring, then the row listing the next', () => {
      const showMore = vi.fn()
      const given = controls({ kept: many, showMore })
      const stations = buildSettingsStations([historySection(given)], 'history', [])
      const more = stations.at(-1)!

      expect(keysOf(given).filter((key) => key.startsWith('item:history:page:'))).toHaveLength(100)
      expect(more).toMatchObject({ kind: 'action', reveals: true })
      expect(more.kind === 'action' && more.action).toMatchObject({
        id: 'more-pages',
        label: 'Show 100 more',
        description: '150 older pages not listed yet',
        trail: '150',
      })

      if (more.kind === 'action') {
        more.action.run()
      }

      expect(showMore).toHaveBeenCalled()
    })

    it('lists no such row once every page is listed', () => {
      const keys = keysOf(controls({ kept: many, shown: 300 }))

      expect(keys.filter((key) => key.startsWith('item:history:page:'))).toHaveLength(250)
      expect(keys).not.toContain('action:history:more-pages')
    })

    // The filter bar searches every kept page, not only the ones listed.
    it('finds a page beyond the first hundred through a term', () => {
      expect(keysOf(controls({ kept: many }), 'site240')).toContain('item:history:page:240')
    })
  })
})

describe('searching an open history section', () => {
  // The field and the clearing row act on the whole section, so a term narrowing it to one page
  // must not take away the way to add another or to forget them all.
  it('narrows the pages and domains, and keeps the field and the clearing row', () => {
    const [section] = searchSections([historySection(controls())], 'github', 'history')

    expect(section!.rows!.map((row) => row.id)).toEqual(['exclude', 'clear-history', 'pages'])
    expect(
      (section!.rows!.find((row) => row.kind === 'paged') as SettingsPagedItems).items.map(
        (item) => item.id,
      ),
    ).toEqual(['page:1'])
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
