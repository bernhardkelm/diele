import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_CACHE_KEY, ENTRIES_CACHE_KEY } from '@/config/api'
import { resetConnectorEntries, useConnectorEntries } from '@/composables/useConnectorEntries'
import { resetPortalConfig } from '@/composables/usePortalConfig'
import { useSession } from '@/composables/useSession'

const ENTRIES = {
  entries: [
    {
      ref: 'gitlab:1:1',
      connectorId: 1,
      connectorType: 'gitlab',
      kind: 'row',
      label: 'private-repo',
      detail: 'someone-elses-group',
      url: 'https://gitlab.example/someone-elses-group/private-repo',
      keywords: [],
      actions: [],
      timestamp: null,
      parentRef: null,
      searchOnly: false,
    },
  ],
  sources: [],
  hidden: { all: [], mine: [] },
}

/**
 * Fills both caches the way a signed-in visit leaves them.
 * @returns {void}
 */
function seedCaches(): void {
  localStorage.setItem(
    ENTRIES_CACHE_KEY,
    JSON.stringify({ storedAt: Date.now(), payload: ENTRIES, etag: 'W/"1"' }),
  )
  localStorage.setItem(
    CONFIG_CACHE_KEY,
    JSON.stringify({ storedAt: Date.now(), config: { cards: [], sites: [] }, etag: 'W/"1"' }),
  )
}

const realLocation = window.location

beforeEach(() => {
  localStorage.clear()
  resetPortalConfig()
  resetConnectorEntries()
  vi.restoreAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})

  // Signing out navigates, which jsdom cannot do. Replacing the whole object is the only way
  // in: `assign` is not configurable on the real one.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign: vi.fn(), pathname: '/', search: '', hash: '' },
  })
})

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  resetPortalConfig()
  resetConnectorEntries()
  localStorage.clear()
  vi.unstubAllGlobals()
})

describe('signing out', () => {
  // Connector entries name a person's repositories, groups and project urls. Leaving them in
  // storage means the next visitor to a shared browser reads them, and reading them back is what
  // paints them on screen before anything has decided whether that visitor is signed in.
  it('takes the cached entries with it, not only the cached config', async () => {
    seedCaches()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ logoutUrl: '/' })))),
    )

    await useSession().signOut()

    expect(localStorage.getItem(ENTRIES_CACHE_KEY)).toBeNull()
    expect(localStorage.getItem(CONFIG_CACHE_KEY)).toBeNull()
  })

  // `resetConnectorEntries` re-arms hydration on purpose, so clearing memory without clearing
  // storage would hand the next reader the same rows straight back.
  it('leaves nothing for the next reader to hydrate from', async () => {
    seedCaches()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ logoutUrl: '/' })))),
    )

    await useSession().signOut()
    resetConnectorEntries()

    expect(useConnectorEntries().rows.value).toEqual([])
  })

  // Only the server can end a session and clear an httpOnly cookie. Dropping local state anyway
  // would leave someone believing they had signed out while the session stayed open.
  it('keeps the caches when the server did not end the session', async () => {
    seedCaches()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 500 }))),
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await useSession().signOut()

    expect(localStorage.getItem(ENTRIES_CACHE_KEY)).not.toBeNull()
  })

  // Two routes rather than a flag on one, so the endpoint that ends every session an account
  // has is never one a mistyped body can reach.
  it('asks the everywhere endpoint when the other devices are meant too', async () => {
    seedCaches()
    const fetchMock = vi.fn((_input: RequestInfo | URL) =>
      Promise.resolve(new Response(JSON.stringify({ logoutUrl: '/' }))),
    )
    vi.stubGlobal('fetch', fetchMock)

    await useSession().signOutEverywhere()

    expect(fetchMock.mock.calls.map((call) => call[0])).toContain('/api/auth/logout-all')
    expect(localStorage.getItem(ENTRIES_CACHE_KEY)).toBeNull()
  })
})
