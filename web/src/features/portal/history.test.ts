import { beforeEach, describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useLaunchHistory } from '@/features/portal/useLaunchHistory'
import { useSearchEngine } from '@/features/portal/useSearchEngine'
import { useVisitedUrls } from '@/features/portal/useVisitedUrls'
import type { SearchEngine } from '@/types/portal'

beforeEach(() => {
  localStorage.clear()
})

describe('useLaunchHistory', () => {
  it('gives nothing to a target that has never been opened', () => {
    expect(useLaunchHistory().boostFor('card:1')).toBe(0)
    expect(useLaunchHistory().boostFor('')).toBe(0)
  })

  it('rewards what was opened, most for the most recent', () => {
    const history = useLaunchHistory()

    history.remember('card:1')
    history.remember('card:2')

    expect(history.boostFor('card:2')).toBeGreaterThan(history.boostFor('card:1'))
    expect(history.boostFor('card:1')).toBeGreaterThan(0)
  })

  // Small enough that a weak match never overtakes a strong one on habit alone. The tiers in
  // fuzzyMatch are 100 apart, so the bonus has to stay inside one.
  it('keeps the bonus small enough not to jump a match tier', () => {
    const history = useLaunchHistory()
    history.remember('card:1')

    expect(history.boostFor('card:1')).toBeLessThanOrEqual(120)
  })

  it('moves a target back to the front rather than counting it twice', () => {
    const history = useLaunchHistory()

    history.remember('card:1')
    history.remember('card:2')
    history.remember('card:1')

    expect(history.boostFor('card:1')).toBeGreaterThan(history.boostFor('card:2'))
  })

  it('ignores a target with no identity', () => {
    const history = useLaunchHistory()
    history.remember('')

    expect(history.boostFor('')).toBe(0)
  })

  it('outlives the visit', () => {
    useLaunchHistory().remember('card:1')

    expect(useLaunchHistory().boostFor('card:1')).toBeGreaterThan(0)
  })

  // Keyed by ref rather than url: renaming a repo changes its url, and a history keyed on
  // that would quietly forget everything ever opened from it.
  it('drops the oldest past its cap', () => {
    const history = useLaunchHistory()

    for (let i = 0; i < 35; i += 1) {
      history.remember(`card:${i}`)
    }

    expect(history.boostFor('card:0')).toBe(0)
    expect(history.boostFor('card:34')).toBeGreaterThan(0)
  })
})

describe('useVisitedUrls', () => {
  // Only the base is kept, so the same host reached through two paths is one entry.
  it('keeps the origin rather than the path it was reached through', () => {
    const visited = useVisitedUrls()

    visited.remember('https://example.com/some/deep/path?q=1')

    expect(localStorage.getItem('diele:visited-urls')).toBe(JSON.stringify(['https://example.com']))
  })

  it('moves a host already in the list rather than adding it twice', () => {
    const visited = useVisitedUrls()

    visited.remember('https://a.example/one')
    visited.remember('https://b.example/two')
    visited.remember('https://a.example/three')

    expect(JSON.parse(localStorage.getItem('diele:visited-urls')!)).toEqual([
      'https://a.example',
      'https://b.example',
    ])
  })

  it('ignores a url it cannot parse', () => {
    useVisitedUrls().remember('not a url')

    expect(localStorage.getItem('diele:visited-urls')).toBeNull()
  })

  it('keeps the port, since a dev server is only reachable with it', () => {
    useVisitedUrls().remember('http://localhost:5173/x')

    expect(JSON.parse(localStorage.getItem('diele:visited-urls')!)).toEqual([
      'http://localhost:5173',
    ])
  })
})

describe('useSearchEngine', () => {
  const engines: ReadonlyArray<SearchEngine> = [
    { id: '1', name: 'DuckDuckGo', urlTemplate: 'https://duckduckgo.com/?q={query}' },
    { id: '2', name: 'Kagi', urlTemplate: 'https://kagi.com/search?q={query}' },
  ]

  // Every page load starts back at the first engine, so the default is always what Enter does.
  it('starts on the first engine', () => {
    expect(useSearchEngine(() => engines).engine.value?.name).toBe('DuckDuckGo')
  })

  it('cycles forwards and back, wrapping at either end', () => {
    const { engine, cycle } = useSearchEngine(() => engines)

    cycle()
    expect(engine.value?.name).toBe('Kagi')

    cycle()
    expect(engine.value?.name).toBe('DuckDuckGo')

    cycle(-1)
    expect(engine.value?.name).toBe('Kagi')
  })

  it('builds the query url, encoding the term', () => {
    const { urlFor } = useSearchEngine(() => engines)

    expect(urlFor('  vue router & more ')).toBe(
      'https://duckduckgo.com/?q=vue%20router%20%26%20more',
    )
  })

  it('answers with nothing while the portal has no engine configured', () => {
    const { engine, urlFor, cycle } = useSearchEngine(() => [])

    expect(engine.value).toBeUndefined()
    expect(urlFor('anything')).toBeUndefined()
    expect(() => cycle()).not.toThrow()
  })

  // Read through the getter on every access, so a configuration that loads later is picked up.
  it('picks up engines that arrive after the first read', () => {
    const current = ref<ReadonlyArray<SearchEngine>>([])
    const { engine } = useSearchEngine(() => current.value)

    expect(engine.value).toBeUndefined()

    current.value = engines
    expect(engine.value?.name).toBe('DuckDuckGo')
  })

  it('falls back to the first engine when the choice is past the end of a shortened list', () => {
    const current = ref<ReadonlyArray<SearchEngine>>(engines)
    const { engine, cycle } = useSearchEngine(() => current.value)

    cycle()
    expect(engine.value?.name).toBe('Kagi')

    current.value = [engines[0]!]
    expect(engine.value?.name).toBe('DuckDuckGo')
  })
})
