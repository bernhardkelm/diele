import { beforeEach, describe, expect, it } from 'vitest'
import { CONFIG_CACHE_KEY, ENTRIES_CACHE_KEY } from '@/config/api'
import { clearConfigCache, readConfigCache, writeConfigCache } from '@/helpers/configCache'
import { readEntriesCache, writeEntriesCache } from '@/helpers/entriesCache'
import { writeJson } from '@/helpers/storage'
import { toEntryTarget } from '@/helpers/entryTargets'
import type { ApiConfig, ApiEntries, ApiEntry } from '@diele/common'

const config = {
  brand: { title: 'diele', subtitle: 'start page', accentLight: '#16a34a', accentDark: '#22c55e' },
  cards: [],
  sites: [],
  engines: [],
  commands: [],
  localhost: [],
  settings: {},
} as unknown as ApiConfig

const entries: ApiEntries = {
  entries: [],
  sources: [],
  hidden: { all: [], mine: [] },
}

beforeEach(() => {
  localStorage.clear()
})

describe('the config cache', () => {
  it('round-trips a payload and its etag', () => {
    writeConfigCache(config, 'W/"abc"')

    const entry = readConfigCache()
    expect(entry?.config.brand.title).toBe('diele')
    expect(entry?.etag).toBe('W/"abc"')
    expect(typeof entry?.storedAt).toBe('number')
  })

  it('leaves the etag out when the response carried none', () => {
    writeConfigCache(config, null)

    expect(readConfigCache()?.etag).toBeUndefined()
  })

  it('reads an empty cache as nothing', () => {
    expect(readConfigCache()).toBeUndefined()
  })

  it('is cleared on demand, so the next read has to go to the API', () => {
    writeConfigCache(config, null)
    clearConfigCache()

    expect(readConfigCache()).toBeUndefined()
  })

  // An entry written by an older build has an older shape, and painting from it would fail
  // further in where there is no way back.
  it('refuses an entry whose lists are not lists', () => {
    for (const broken of [
      {},
      { cards: [], sites: [] },
      { cards: [], sites: [], engines: 'nope' },
      { cards: 'nope', sites: [], engines: [] },
      { cards: [], sites: null, engines: [] },
    ]) {
      writeJson(CONFIG_CACHE_KEY, { storedAt: Date.now(), config: broken })

      expect(readConfigCache(), JSON.stringify(broken)).toBeUndefined()
    }
  })

  it('refuses an entry carrying no config at all', () => {
    writeJson(CONFIG_CACHE_KEY, { storedAt: Date.now() })

    expect(readConfigCache()).toBeUndefined()
  })
})

describe('the entries cache', () => {
  it('round-trips a payload and its etag', () => {
    writeEntriesCache(entries, 'W/"def"')

    const entry = readEntriesCache()
    expect(entry?.payload.entries).toEqual([])
    expect(entry?.etag).toBe('W/"def"')
  })

  it('fills in the parts an older entry may not carry', () => {
    writeJson(ENTRIES_CACHE_KEY, { storedAt: Date.now(), payload: { entries: [] } })

    const entry = readEntriesCache()
    expect(entry?.payload.sources).toEqual([])
    expect(entry?.payload.hidden).toEqual({ all: [], mine: [] })
  })

  it('refuses an entry whose entries are not a list', () => {
    for (const payload of [undefined, {}, { entries: 'nope' }]) {
      writeJson(ENTRIES_CACHE_KEY, { storedAt: Date.now(), payload })

      expect(readEntriesCache(), JSON.stringify(payload)).toBeUndefined()
    }
  })

  it('reads an empty cache as nothing', () => {
    expect(readEntriesCache()).toBeUndefined()
  })
})

describe('toEntryTarget', () => {
  const base: ApiEntry = {
    ref: 'gitlab:1:project-2',
    connectorId: 1,
    connectorType: 'gitlab',
    kind: 'row',
    label: 'web',
    detail: 'example-group',
    url: 'https://gitlab.example/example-group/web',
    keywords: ['vue'],
    actions: [],
    timestamp: '2026-01-01T00:00:00.000Z',
    parentRef: 'gitlab:1:group-9',
    searchOnly: false,
  }

  // The kind decides the shape, so nothing here knows which connector produced it.
  it('maps a row with everything it carries', () => {
    const target = toEntryTarget(base)

    expect(target).toMatchObject({
      kind: 'row',
      ref: base.ref,
      name: 'web',
      url: base.url,
      detail: 'example-group',
      timestamp: base.timestamp,
      parentRef: base.parentRef,
      connectorId: 1,
    })
  })

  it('maps a suggestion, carrying its detail as the second column', () => {
    const target = toEntryTarget({ ...base, kind: 'suggestion' })

    expect(target).toMatchObject({ kind: 'suggestion', display: 'example-group' })
  })

  // A produced card carries no icon of its own yet, so it renders as a wordmark tile.
  it('maps a card with an empty icon', () => {
    const target = toEntryTarget({ ...base, kind: 'card' })

    expect(target).toMatchObject({ kind: 'card', icon: '', color: 'currentColor' })
  })

  it('leaves out the optional parts an entry does not carry', () => {
    const target = toEntryTarget({
      ...base,
      detail: null,
      timestamp: null,
      parentRef: null,
    })

    expect(target).not.toHaveProperty('detail')
    expect(target).not.toHaveProperty('timestamp')
    expect(target).not.toHaveProperty('parentRef')
    expect(target).not.toHaveProperty('searchOnly')
    expect(target).not.toHaveProperty('actions')
  })

  it('carries searchOnly and actions only when they say something', () => {
    const target = toEntryTarget({
      ...base,
      searchOnly: true,
      actions: [{ label: 'Issues', title: 'Open issues', href: 'https://gitlab.example/issues' }],
    })

    expect(target.searchOnly).toBe(true)
    expect(target.actions).toHaveLength(1)
  })
})
