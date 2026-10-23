import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_CACHE_KEY, ENTRIES_CACHE_KEY, LAUNCH_HISTORY_KEY } from '@/config/api'
import { resetConnectorEntries, useConnectorEntries } from '@/composables/useConnectorEntries'
import { resetHistory, useHistory } from '@/composables/useHistory'
import { withSetup } from '@tests/support/withSetup'
import { resetPortalConfig } from '@/composables/usePortalConfig'
import { recheckSession, resetSession, useSession } from '@/composables/useSession'
import { reportLapse, sessionLapsed } from '@/composables/sessionLapse'
import { useLaunchHistory } from '@/features/portal/useLaunchHistory'

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
  resetSession()
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
  resetSession()
  vi.useRealTimers()
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

  // The ranking is this browser's rather than the account's, so what one person opened must not
  // go on ranking for whoever signs in next.
  it('takes the launch ranking with it, on either route out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ logoutUrl: '/' })))),
    )

    localStorage.setItem(LAUNCH_HISTORY_KEY, JSON.stringify(['card:1']))
    await useSession().signOut()
    expect(localStorage.getItem(LAUNCH_HISTORY_KEY)).toBeNull()

    localStorage.setItem(LAUNCH_HISTORY_KEY, JSON.stringify(['card:1']))
    await useSession().signOutEverywhere()
    expect(localStorage.getItem(LAUNCH_HISTORY_KEY)).toBeNull()
  })

  // A reader already on screen ranks from memory, so clearing storage alone would leave it ranking.
  it('clears the ranking a reader on screen holds as well, on every route out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              String(input).includes('/api/auth/providers')
                ? { providers: [], mode: 'local' }
                : { logoutUrl: '/' },
            ),
          ),
        ),
      ),
    )

    const { result: ranking } = withSetup(() => useLaunchHistory())
    const session = useSession()
    await session.loadProviders()

    for (const leave of [session.signOut, session.signOutEverywhere, session.signIn]) {
      ranking.remember('card:1')
      expect(ranking.boostFor('card:1')).toBeGreaterThan(0)

      await leave()

      expect(ranking.boostFor('card:1')).toBe(0)
    }

    resetSession()
  })

  // Where someone has been is held in memory, and the next account on this page must not see it.
  it('drops the visited pages held in memory', async () => {
    const state = {
      available: true,
      sources: { diele: true, extension: false },
      enabled: true,
      excludedDomains: [],
      kept: 1,
    }
    const page = { id: 1, url: 'https://a.example/', visits: 1, lastVisitedAt: '2026-10-01' }

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              String(input) === '/api/history' ? { state, entries: [page] } : { logoutUrl: '/' },
            ),
          ),
        ),
      ),
    )

    const { result } = withSetup(() => useHistory(() => true))
    await vi.waitFor(() => expect(result.entries.value).toHaveLength(1))

    await useSession().signOut()

    expect(result.entries.value).toEqual([])
    expect(result.state.value.available).toBe(false)
    resetHistory()
  })
})

/**
 * Answers the session endpoints the way a deployment in the given mode does, with /me answering
 * whatever status the test is about.
 * @param {object} options - Mode the providers endpoint names, and what /me answers with
 * @returns {ReturnType<typeof vi.fn>} - The stubbed fetch
 */
function stubSession(options: { mode?: 'local' | 'oidc' | 'dev'; me?: number } = {}) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input)

    if (url.includes('/api/auth/providers')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            mode: options.mode ?? 'local',
            setupRequired: false,
            providers: options.mode === 'oidc' ? [{ id: 'oidc', name: 'Single Sign-On' }] : [],
          }),
        ),
      )
    }

    if (url.includes('/api/auth/me')) {
      const status = options.me ?? 200

      return Promise.resolve(
        status === 200
          ? new Response(
              JSON.stringify({ id: 1, name: 'Ada', email: null, picture: null, canAdmin: true }),
            )
          : new Response(JSON.stringify({ error: 'authentication required' }), { status }),
      )
    }

    return Promise.resolve(new Response(JSON.stringify({ entries: [], sources: [] })))
  })
}

describe('reading who is signed in', () => {
  it('records a lapse when /me answers 401', async () => {
    vi.stubGlobal('fetch', stubSession({ me: 401 }))

    const { lapsed } = useSession()

    await vi.waitFor(() => expect(lapsed.value).toBe(true))
  })

  // Read back as live is the one answer that settles a lapse, wherever it was recorded.
  it('lets go of a lapse once /me reads the session back', async () => {
    reportLapse(401)
    vi.stubGlobal('fetch', stubSession())

    const { lapsed, user } = useSession()

    await vi.waitFor(() => expect(user.value?.name).toBe('Ada'))
    expect(lapsed.value).toBe(false)
  })

  it('does not take a 403 for a lapse', async () => {
    const fetchMock = stubSession({ me: 403 })
    vi.stubGlobal('fetch', fetchMock)

    const { lapsed } = useSession()

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await Promise.resolve()
    expect(lapsed.value).toBe(false)
  })
})

describe('signing back in after a lapse', () => {
  // The issuer still holds its own session, so the redirect comes straight back signed in, and
  // nothing painted has to be dropped on the way.
  it('goes straight to the issuer in oidc mode, keeping the caches', async () => {
    seedCaches()
    vi.stubGlobal('fetch', stubSession({ mode: 'oidc', me: 401 }))

    const session = useSession()
    await session.loadProviders()
    session.resume()

    expect(window.location.assign).toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/login?redirect='),
    )
    expect(session.reauth.value).toBe(false)
    expect(localStorage.getItem(CONFIG_CACHE_KEY)).not.toBeNull()
  })

  it('goes straight to the login route in dev mode', async () => {
    vi.stubGlobal('fetch', stubSession({ mode: 'dev', me: 401 }))

    const session = useSession()
    await session.loadProviders()
    session.resume()

    expect(window.location.assign).toHaveBeenCalledOnce()
  })

  // A password cannot be had by redirecting, so the gate's form comes up over the portal rather
  // than the caches being dropped to bring it back the way a cold start would.
  it('hands the screen to the gate in local mode, keeping the caches', async () => {
    seedCaches()
    vi.stubGlobal('fetch', stubSession({ mode: 'local', me: 401 }))

    const session = useSession()
    await session.loadProviders()
    session.resume()

    expect(session.reauth.value).toBe(true)
    expect(window.location.assign).not.toHaveBeenCalled()
    expect(localStorage.getItem(CONFIG_CACHE_KEY)).not.toBeNull()
    expect(localStorage.getItem(ENTRIES_CACHE_KEY)).not.toBeNull()
  })

  it('hands the screen to the gate while the mode is not known yet', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )

    const session = useSession()
    session.resume()

    expect(session.reauth.value).toBe(true)
    expect(window.location.assign).not.toHaveBeenCalled()
  })
})

describe('re-checking the session', () => {
  it('reads /me once for several asks inside the window', async () => {
    vi.useFakeTimers()
    const fetchMock = stubSession({ me: 401 })
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([recheckSession(), recheckSession()])
    await recheckSession()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sessionLapsed.value).toBe(true)

    vi.advanceTimersByTime(10_000)
    await recheckSession()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // Signed back in from another tab: nothing else retries the reads that answered 401 meanwhile,
  // so the portal would keep painting the copy it fell back on.
  it('refetches the config, the entries and the history once a lapse turns out to be over', async () => {
    reportLapse(401)
    const fetchMock = stubSession()
    vi.stubGlobal('fetch', fetchMock)
    // the portal's own reader, without which the history is not asked for at all
    withSetup(() => useHistory(() => true))
    fetchMock.mockClear()

    await recheckSession()

    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(sessionLapsed.value).toBe(false)
    expect(urls).toContain('/api/config')
    expect(urls).toContain('/api/entries')
    expect(urls).toContain('/api/history')
  })

  it('refetches nothing when there was no lapse to recover from', async () => {
    const fetchMock = stubSession()
    vi.stubGlobal('fetch', fetchMock)

    await recheckSession()

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual(['/api/auth/me'])
  })
})
