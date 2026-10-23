import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_FEATURES_URL } from '@/config/api'
import { resetAdmin, useAdmin } from '@/features/admin/useAdmin'
import { clearLapse, sessionLapsed } from '@/composables/sessionLapse'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resetAdmin()
  clearLapse()
})

describe('loading the registry', () => {
  // The view calls this on mount and cannot await it, so a rejection raised out of here is
  // discarded by the caller: the panel then paints an empty list with no word about why, which
  // reads as the admin view being broken rather than as a session that ended.
  it('holds a lapsed session rather than raising it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'authentication required' }), { status: 401 }),
        ),
      ),
    )

    const admin = useAdmin()

    await expect(admin.loadFeatures()).resolves.toBeUndefined()

    expect(admin.needsAuth.value).toBe(true)
    expect(admin.error.value).toBeUndefined()
    expect(sessionLapsed.value).toBe(true)
  })

  // Signing in again cannot fix this one, so it is held apart from the lapse: the view offers
  // the way out instead of handing over to the gate, which the same account would only return
  // from.
  it('holds a refusal apart from a lapse', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })),
      ),
    )

    const admin = useAdmin()
    await admin.loadFeatures()

    expect(admin.forbidden.value).toBe(true)
    expect(admin.needsAuth.value).toBe(false)
    expect(sessionLapsed.value).toBe(false)
  })

  it('reads the features a signed-in session is given', async () => {
    const features = [{ id: 'cards', label: 'Cards' }]
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) =>
        Promise.resolve(
          String(input) === ADMIN_FEATURES_URL
            ? new Response(JSON.stringify({ features }))
            : new Response('{}', { status: 404 }),
        ),
      ),
    )

    const admin = useAdmin()
    await admin.loadFeatures()

    expect(admin.features.value.map((feature) => feature.id)).toEqual(['cards'])
    expect(admin.needsAuth.value).toBe(false)
  })

  // Signing in unmounts the panel and mounts it again, but the flag is held at module scope and
  // survives that. Left standing, it hides the body of a panel whose session is now fine.
  it('lets go of a lapse once a load is answered', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: 'authentication required' }), { status: 401 }),
        ),
      ),
    )

    const admin = useAdmin()
    await admin.loadFeatures()
    expect(admin.needsAuth.value).toBe(true)

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ features: [] })))),
    )
    await admin.loadFeatures()

    expect(admin.needsAuth.value).toBe(false)
  })
})

describe('a write the server refuses', () => {
  const FEATURES = [{ id: 'cards', label: 'Cards', collection: '/api/admin/links/card' }]

  /**
   * Answers the reads, and the write with whatever status the test is about.
   * @param {number} status - What the write answers with
   * @param {string} message - The error the server names
   * @returns {ReturnType<typeof vi.fn>} - The stubbed fetch
   */
  function stubWrite(status: number, message: string) {
    return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve(new Response(JSON.stringify({ error: message }), { status }))
      }

      return Promise.resolve(
        new Response(
          JSON.stringify(
            String(input) === ADMIN_FEATURES_URL ? { features: FEATURES } : { rows: [] },
          ),
        ),
      )
    })
  }

  // The panel's first read already turns away an account that may not configure, so a write
  // refused with a 403 was refused for something else, its origin for one. That is something to
  // read rather than a reason to hide the panel or hand it to the gate.
  it('holds a 403 on a write as an error to read', async () => {
    vi.stubGlobal('fetch', stubWrite(403, 'cross-origin request rejected'))

    const admin = useAdmin()
    await admin.loadFeatures()
    await admin.expand('cards')

    await expect(admin.create({ label: 'Grafana' })).resolves.toBe(false)

    expect(admin.error.value).toBe('cross-origin request rejected')
    expect(admin.forbidden.value).toBe(false)
    expect(admin.needsAuth.value).toBe(false)
    expect(sessionLapsed.value).toBe(false)
  })

  it('holds a 401 on a write as the lapse it is', async () => {
    vi.stubGlobal('fetch', stubWrite(401, 'authentication required'))

    const admin = useAdmin()
    await admin.loadFeatures()
    await admin.expand('cards')
    await admin.create({ label: 'Grafana' })

    expect(admin.needsAuth.value).toBe(true)
    expect(admin.error.value).toBeUndefined()
    expect(sessionLapsed.value).toBe(true)
  })
})
