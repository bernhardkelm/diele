import { describe, expect, it } from 'vitest'
import { DEFAULT_BRAND, EMPTY_CONFIG, toPortalConfig } from '@/helpers/portalConfig'
import type { ApiConfig } from '@diele/common'

const payload = {
  brand: { title: 'diele', subtitle: 'start page', accentLight: '#111111', accentDark: '#222222' },
  cards: [
    {
      id: 1,
      ref: 'card:1',
      kind: 'card',
      label: 'Grafana',
      url: 'https://grafana.example',
      display: null,
      keywords: ['metrics'],
      icon: '<svg/>',
      iconId: 3,
      color: '#1E88E5',
      position: 1000,
    },
  ],
  sites: [
    {
      id: 2,
      ref: 'site:2',
      kind: 'site',
      label: 'Docs',
      url: 'https://docs.example',
      display: 'the handbook',
      keywords: [],
      icon: null,
      iconId: null,
      color: null,
      position: 1000,
    },
  ],
  engines: [
    {
      id: 5,
      ref: 'engine:5',
      name: 'DuckDuckGo',
      urlTemplate: 'https://d.test/?q={query}',
      position: 1000,
    },
  ],
  commands: [],
  localhost: [
    {
      id: 7,
      ref: 'port:7',
      scheme: 'https',
      port: 5173,
      url: 'https://localhost:5173',
      keywords: ['vue'],
      position: 1000,
    },
  ],
  settings: { 'reddit.enabled': false },
} as unknown as ApiConfig

describe('toPortalConfig', () => {
  it('maps a card, inlining the markup the API already sanitised', () => {
    const card = toPortalConfig(payload).cards[0]!

    expect(card).toEqual({
      ref: 'card:1',
      kind: 'card',
      name: 'Grafana',
      url: 'https://grafana.example',
      keywords: ['metrics'],
      icon: '<svg/>',
      color: '#1E88E5',
    })
  })

  it('falls back to a wordmark tile and the inherited colour', () => {
    const bare = { ...payload, cards: [{ ...payload.cards[0]!, icon: null, color: null }] }
    const card = toPortalConfig(bare as ApiConfig).cards[0]!

    expect(card.icon).toBe('')
    expect(card.color).toBe('currentColor')
  })

  // Saved sites are only offered while a term is being searched.
  it('maps a saved site as a search-only suggestion', () => {
    const site = toPortalConfig(payload).sites[0]!

    expect(site).toMatchObject({
      ref: 'site:2',
      kind: 'suggestion',
      name: 'Docs',
      display: 'the handbook',
      searchOnly: true,
    })
  })

  it('leaves out a display the row does not carry', () => {
    const bare = { ...payload, sites: [{ ...payload.sites[0]!, display: null }] }

    expect(toPortalConfig(bare as ApiConfig).sites[0]).not.toHaveProperty('display')
  })

  // A port joins the saved sites rather than forming its own section: it renders the same way
  // and is probed by the same code.
  it('folds local ports into the saved sites', () => {
    const sites = toPortalConfig(payload).sites

    expect(sites).toHaveLength(2)
    expect(sites[1]).toMatchObject({
      ref: 'port:7',
      kind: 'suggestion',
      name: 'localhost:5173',
      url: 'https://localhost:5173',
      display: 'vue',
      searchOnly: true,
    })
  })

  it('makes a port findable by its number and the names people use for it', () => {
    const port = toPortalConfig(payload).sites[1]!

    expect(port.keywords).toEqual(['5173', 'localhost', 'lh', 'vue'])
  })

  it('leaves a port without tags showing its host instead', () => {
    const untagged = { ...payload, localhost: [{ ...payload.localhost![0]!, keywords: [] }] }
    const port = toPortalConfig(untagged as ApiConfig).sites[1]!

    expect(port.display).toBeUndefined()
    expect(port.keywords).toEqual(['5173', 'localhost', 'lh'])
  })

  it('maps an engine, keying it by its id as a string', () => {
    expect(toPortalConfig(payload).engines[0]).toEqual({
      id: '5',
      name: 'DuckDuckGo',
      urlTemplate: 'https://d.test/?q={query}',
    })
  })

  it('carries the settings through untouched', () => {
    expect(toPortalConfig(payload).settings).toEqual({ 'reddit.enabled': false })
  })

  // A portal that has never reached the API still reads as a portal rather than a blank page.
  it('falls back to the built-in brand and copes with sections an older payload lacks', () => {
    const sparse = {
      cards: [],
      sites: [],
      engines: [],
      settings: {},
    } as unknown as ApiConfig

    const config = toPortalConfig(sparse)

    expect(config.brand).toBe(DEFAULT_BRAND)
    expect(config.commands).toEqual([])
    expect(config.sites).toEqual([])
  })
})

it('starts empty rather than undefined, so the page can render before anything answers', () => {
  expect(EMPTY_CONFIG.cards).toEqual([])
  expect(EMPTY_CONFIG.sites).toEqual([])
  expect(EMPTY_CONFIG.brand).toBe(DEFAULT_BRAND)
})
