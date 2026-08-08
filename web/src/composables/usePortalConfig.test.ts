import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_CACHE_KEY } from '@/config/api'
import { resetPortalConfig, usePortalConfig } from '@/composables/usePortalConfig'
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
      keywords: [],
      icon: null,
      iconId: null,
      color: null,
      position: 1000,
    },
  ],
  sites: [],
  engines: [],
  commands: [],
  localhost: [],
  settings: {},
} as unknown as ApiConfig

/**
 * Answers the config request with a payload and an etag.
 * @param {object} init - Status, body and etag to answer with
 * @returns {Response} - The response
 */
function configResponse(init: { status?: number; body?: unknown; etag?: string } = {}): Response {
  return new Response(init.body === undefined ? null : JSON.stringify(init.body), {
    status: init.status ?? 200,
    headers: init.etag ? { etag: init.etag, 'content-type': 'application/json' } : {},
  })
}

beforeEach(() => {
  localStorage.clear()
  resetPortalConfig()
  vi.restoreAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  resetPortalConfig()
  localStorage.clear()
})

describe('a cold start', () => {
  it('has nothing to paint until the network answers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(configResponse({ body: payload, etag: 'W/"1"' }))
    vi.stubGlobal('fetch', fetchMock)

    const source = usePortalConfig()
    expect(source.hasConfig.value).toBe(false)

    await source.refresh()

    expect(source.state.value).toBe('ready')
    expect(source.cards.value).toHaveLength(1)
    expect(source.brand.value.title).toBe('diele')
  })

  it('caches what it fetched, so the next visit paints before the network answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(configResponse({ body: payload, etag: 'W/"1"' })),
    )

    await usePortalConfig().refresh()

    expect(localStorage.getItem(CONFIG_CACHE_KEY)).toContain('Grafana')
  })
})

describe('a later visit', () => {
  it('paints from the cache before anything is fetched', async () => {
    localStorage.setItem(
      CONFIG_CACHE_KEY,
      JSON.stringify({ storedAt: Date.now(), config: payload, etag: 'W/"1"' }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )

    const source = usePortalConfig()

    expect(source.state.value).toBe('ready')
    expect(source.hasConfig.value).toBe(true)
    expect(source.cards.value[0]?.name).toBe('Grafana')
  })

  // An unchanged payload costs a 304 with an empty body rather than the whole document again.
  it('revalidates with the cached etag and keeps what it has on 304', async () => {
    localStorage.setItem(
      CONFIG_CACHE_KEY,
      JSON.stringify({ storedAt: Date.now(), config: payload, etag: 'W/"1"' }),
    )
    const fetchMock = vi.fn().mockResolvedValue(configResponse({ status: 304 }))
    vi.stubGlobal('fetch', fetchMock)

    const source = usePortalConfig()
    await source.refresh()

    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>
    expect(headers['if-none-match']).toBe('W/"1"')
    expect(source.state.value).toBe('ready')
    expect(source.cards.value).toHaveLength(1)
  })
})

describe('when the request does not succeed', () => {
  // Not an error: the session simply lapsed. Whether that interrupts anyone is App's call.
  it('reports a lapsed session rather than failing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(configResponse({ status: 401 })))

    const source = usePortalConfig()
    await source.refresh()

    expect(source.state.value).toBe('needs-auth')
  })

  it('reports unreachable when there was nothing cached to fall back on', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const source = usePortalConfig()
    await source.refresh()

    expect(source.state.value).toBe('unreachable')
    expect(source.hasConfig.value).toBe(false)
  })

  // A portal showing a slightly old tile list beats one showing nothing because revalidation
  // timed out.
  it('keeps the cached config on screen and stays ready', async () => {
    localStorage.setItem(
      CONFIG_CACHE_KEY,
      JSON.stringify({ storedAt: Date.now(), config: payload, etag: 'W/"1"' }),
    )
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const source = usePortalConfig()
    await source.refresh()

    expect(source.state.value).toBe('ready')
    expect(source.cards.value).toHaveLength(1)
  })

  it('keeps the cached config when the server errors', async () => {
    localStorage.setItem(
      CONFIG_CACHE_KEY,
      JSON.stringify({ storedAt: Date.now(), config: payload, etag: 'W/"1"' }),
    )
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(configResponse({ status: 500 })))

    const source = usePortalConfig()
    await source.refresh()

    expect(source.state.value).toBe('ready')
    expect(source.cards.value).toHaveLength(1)
  })
})

// The config is one document, and a second component asking for it must not mean a second
// request.
it('fetches once however many components ask', async () => {
  const fetchMock = vi.fn().mockResolvedValue(configResponse({ body: payload, etag: 'W/"1"' }))
  vi.stubGlobal('fetch', fetchMock)

  const first = usePortalConfig()
  const second = usePortalConfig()
  await Promise.all([first.refresh(), second.refresh()])

  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(second.cards.value).toHaveLength(1)
})

// So the next visitor to this browser does not inherit the last one's portal from a ref that
// outlived their session.
it('drops everything on reset', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(configResponse({ body: payload, etag: 'W/"1"' })),
  )

  const source = usePortalConfig()
  await source.refresh()
  expect(source.hasConfig.value).toBe(true)

  resetPortalConfig()

  expect(source.hasConfig.value).toBe(false)
  expect(source.state.value).toBe('cold')
})
