import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_FEATURES_URL } from '@/config/api'
import { resetAdmin, useAdmin } from '@/features/admin/useAdmin'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resetAdmin()
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
