import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ENTRIES_CACHE_KEY } from '@/config/api'
import {
  refreshConnectorEntries,
  resetConnectorEntries,
  useConnectorEntries,
} from '@/composables/useConnectorEntries'
import { useHiddenEntries } from '@/composables/useHiddenEntries'

const ENTRY = {
  ref: 'gitlab:1:1',
  connectorId: 1,
  connectorType: 'gitlab',
  kind: 'row',
  label: 'web',
  detail: 'example-group',
  url: 'https://gitlab.example/example-group/web',
  keywords: [],
  actions: [],
  timestamp: null,
  parentRef: null,
  searchOnly: false,
}

const PAYLOAD = {
  entries: [ENTRY],
  sources: [{ connectorId: 1, type: 'gitlab', label: 'work', syncedAt: null, error: null }],
  hidden: { all: [], mine: [] },
}

const writes: Array<Record<string, unknown>> = []

/**
 * Answers the entries endpoint, recording any write to the hidden sets.
 * @param {object} options - What the read should answer with
 * @returns {ReturnType<typeof vi.fn>} - The stubbed fetch
 */
function stubApi(options: { payload?: unknown; status?: number; etag?: string } = {}) {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      writes.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return Promise.resolve(new Response(JSON.stringify({ ok: true })))
    }

    return Promise.resolve(
      new Response(options.status === 304 ? null : JSON.stringify(options.payload ?? PAYLOAD), {
        status: options.status ?? 200,
        headers: options.etag ? { etag: options.etag } : {},
      }),
    )
  })
}

beforeEach(() => {
  writes.length = 0
  localStorage.clear()
  resetConnectorEntries()
  vi.restoreAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  resetConnectorEntries()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('reading the entries', () => {
  it('turns what the API served into rows the launcher can reach', async () => {
    vi.stubGlobal('fetch', stubApi())

    const source = useConnectorEntries()
    await refreshConnectorEntries()

    expect(source.rows.value).toHaveLength(1)
    expect(source.rows.value[0]).toMatchObject({
      kind: 'row',
      name: 'web',
      detail: 'example-group',
    })
    expect(source.sources.value[0]?.label).toBe('work')
  })

  it('caches them, so the next visit paints before the network answers', async () => {
    vi.stubGlobal('fetch', stubApi({ etag: 'W/"1"' }))

    await refreshConnectorEntries()

    expect(localStorage.getItem(ENTRIES_CACHE_KEY)).toContain('gitlab:1:1')
  })

  it('paints from the cache on a later visit', () => {
    localStorage.setItem(
      ENTRIES_CACHE_KEY,
      JSON.stringify({ storedAt: Date.now(), payload: PAYLOAD, etag: 'W/"1"' }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )

    expect(useConnectorEntries().rows.value).toHaveLength(1)
  })

  it('keeps what it has when the request answers 304', async () => {
    localStorage.setItem(
      ENTRIES_CACHE_KEY,
      JSON.stringify({ storedAt: Date.now(), payload: PAYLOAD, etag: 'W/"1"' }),
    )
    vi.stubGlobal('fetch', stubApi({ status: 304 }))

    const source = useConnectorEntries()
    await refreshConnectorEntries()

    expect(source.rows.value).toHaveLength(1)
  })

  // A background refresh failing keeps whatever is already on screen: last visit's data beats
  // an error nobody asked for.
  it('keeps the cached rows when the request fails', async () => {
    localStorage.setItem(
      ENTRIES_CACHE_KEY,
      JSON.stringify({ storedAt: Date.now(), payload: PAYLOAD, etag: 'W/"1"' }),
    )
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const source = useConnectorEntries()
    await refreshConnectorEntries()

    expect(source.rows.value).toHaveLength(1)
  })

  it('answers with nothing rather than failing on a cold start that cannot reach the API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const source = useConnectorEntries()
    await refreshConnectorEntries()

    expect(source.rows.value).toEqual([])
    expect(source.sources.value).toEqual([])
  })

  it('drops everything on reset', async () => {
    vi.stubGlobal('fetch', stubApi())

    const source = useConnectorEntries()
    await refreshConnectorEntries()
    expect(source.rows.value).toHaveLength(1)

    resetConnectorEntries()

    expect(source.rows.value).toEqual([])
  })
})

describe('hiding an entry', () => {
  it('reads both scopes back from the payload', async () => {
    vi.stubGlobal(
      'fetch',
      stubApi({ payload: { ...PAYLOAD, hidden: { all: ['a'], mine: ['b'] } } }),
    )
    await refreshConnectorEntries()

    const hidden = useHiddenEntries()

    expect(hidden.forEveryone.value).toEqual(['a'])
    expect(hidden.forMe.value).toEqual(['b'])
  })

  it('reads an entry as hidden when either scope hides it', async () => {
    vi.stubGlobal(
      'fetch',
      stubApi({ payload: { ...PAYLOAD, hidden: { all: ['a'], mine: ['b'] } } }),
    )
    await refreshConnectorEntries()

    const hidden = useHiddenEntries()

    expect(hidden.isHidden('a')).toBe(true)
    expect(hidden.isHidden('b')).toBe(true)
    expect(hidden.isHidden('c')).toBe(false)

    expect(hidden.isHiddenIn('a', 'all')).toBe(true)
    expect(hidden.isHiddenIn('a', 'mine')).toBe(false)
  })

  it('writes the scope it was asked for, flipping what is stored', async () => {
    vi.stubGlobal('fetch', stubApi())
    await refreshConnectorEntries()

    await useHiddenEntries().toggle('gitlab:1:1', 'mine')

    expect(writes).toEqual([{ ref: 'gitlab:1:1', scope: 'mine', hidden: true }])
  })

  it('brings one back when it is already hidden', async () => {
    vi.stubGlobal(
      'fetch',
      stubApi({ payload: { ...PAYLOAD, hidden: { all: [], mine: ['gitlab:1:1'] } } }),
    )
    await refreshConnectorEntries()

    await useHiddenEntries().toggle('gitlab:1:1', 'mine')

    expect(writes).toEqual([{ ref: 'gitlab:1:1', scope: 'mine', hidden: false }])
  })

  it('brings back everything in one scope, leaving the other alone', async () => {
    vi.stubGlobal(
      'fetch',
      stubApi({ payload: { ...PAYLOAD, hidden: { all: ['x'], mine: ['a', 'b'] } } }),
    )
    await refreshConnectorEntries()

    await useHiddenEntries().showAll('mine')

    expect(writes).toEqual([
      { ref: 'a', scope: 'mine', hidden: false },
      { ref: 'b', scope: 'mine', hidden: false },
    ])
  })

  // The list re-reads the truth below anyway, so a failed write shows as the switch staying
  // where it was rather than as an error nobody can act on.
  it('does not throw when the write is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === 'PUT'
          ? Promise.resolve(new Response(null, { status: 403 }))
          : Promise.resolve(new Response(JSON.stringify(PAYLOAD))),
      ),
    )
    await refreshConnectorEntries()

    await expect(useHiddenEntries().toggle('gitlab:1:1', 'all')).resolves.toBeUndefined()
  })
})

// A cache written by an older build and a proxy answering with something unexpected arrive the
// same way. Either would otherwise throw inside a computed while the page is rendering, and
// there is no error boundary between that and a blank portal.
describe('a payload that is not the shape it should be', () => {
  it('fills in the sections it is missing rather than throwing', async () => {
    vi.stubGlobal('fetch', stubApi({ payload: { entries: [{ ...ENTRY }] } }))

    const source = useConnectorEntries()
    await refreshConnectorEntries()

    expect(source.sources.value).toEqual([])
    expect(useHiddenEntries().forEveryone.value).toEqual([])
    expect(useHiddenEntries().forMe.value).toEqual([])
  })

  it('reads an entry with no actions or keywords without throwing', async () => {
    const bare = { ...ENTRY }
    delete (bare as Record<string, unknown>).actions
    delete (bare as Record<string, unknown>).keywords
    vi.stubGlobal('fetch', stubApi({ payload: { ...PAYLOAD, entries: [bare] } }))

    const source = useConnectorEntries()
    await refreshConnectorEntries()

    expect(source.rows.value).toHaveLength(1)
    expect(source.rows.value[0]).toMatchObject({ name: 'web' })
  })

  it('keeps what it has when the payload is not a payload at all', async () => {
    vi.stubGlobal('fetch', stubApi())
    const source = useConnectorEntries()
    await refreshConnectorEntries()
    expect(source.rows.value).toHaveLength(1)

    vi.stubGlobal('fetch', stubApi({ payload: { nonsense: true } }))
    await refreshConnectorEntries()

    expect(source.rows.value).toHaveLength(1)
  })
})
