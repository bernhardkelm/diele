import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { resetSignals, useSignals, type SignalSource } from '@/composables/useSignals'
import { clearLapse, sessionLapsed } from '@/composables/sessionLapse'

const PAYLOAD = {
  signals: [
    { id: '1:aaaa', label: 'PostgresDown', severity: 'critical' },
    { id: '1:bbbb', label: 'CertExpiring', severity: 'warning' },
    { id: '1:cccc', label: 'Watchdog', severity: 'info' },
  ],
  silenced: { all: ['1:cccc'], mine: ['1:bbbb'] },
  total: 1,
  pollSeconds: 60,
}

const writes: Array<Record<string, unknown>> = []

/**
 * Answers the signals endpoint, recording any silence written against it.
 * @param {unknown} payload - What the read should answer with
 * @returns {ReturnType<typeof vi.fn>} - The stubbed fetch
 */
function stubApi(payload: unknown = PAYLOAD) {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      writes.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return Promise.resolve(new Response(JSON.stringify({ ok: true })))
    }

    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
  })
}

/**
 * Mounts a component around the composable, which needs a lifecycle to poll in.
 * @param {boolean} admin - Whether this account speaks for the portal
 * @returns {Promise<SignalSource>} - The composable's surface, once a read has answered
 */
async function open(admin: boolean): Promise<SignalSource> {
  let source: SignalSource | undefined

  mount(
    defineComponent({
      setup() {
        source = useSignals(
          () => true,
          () => admin,
        )
        return () => h('div')
      },
    }),
  )

  await vi.waitFor(() => expect(source?.signals.value.length).toBeGreaterThan(0))

  return source as SignalSource
}

beforeEach(() => {
  writes.length = 0
  resetSignals()
  clearLapse()
  vi.stubGlobal('fetch', stubApi())
})

afterEach(() => {
  resetSignals()
  vi.unstubAllGlobals()
})

describe('useSignals', () => {
  it('keeps the quietened lines out of what is firing', async () => {
    const { signals } = await open(false)

    expect(signals.value.map((entry) => entry.label)).toEqual(['PostgresDown'])
  })

  it('hands back the quietened lines with who quietened each', async () => {
    const { silenced } = await open(false)

    expect(silenced.value.map((entry) => entry.signal.label)).toEqual([
      'CertExpiring',
      'Watchdog',
    ])
    expect(silenced.value.map((entry) => entry.byPortal)).toEqual([false, true])
  })

  // The rule the server enforces on the way in, mirrored here so the page only offers a way back
  // where pressing it would actually do something.
  it('lets a member lift only their own', async () => {
    const { silenced } = await open(false)
    const [mine, portal] = silenced.value

    expect(mine?.restorable).toBe(true)
    expect(portal?.restorable).toBe(false)
  })

  it('lets an admin lift the portal’s rather than a member’s', async () => {
    const { silenced } = await open(true)
    const [mine, portal] = silenced.value

    expect(mine?.restorable).toBe(false)
    expect(portal?.restorable).toBe(true)
  })

  it('moves a line the moment it is silenced, before the write lands', async () => {
    const source = await open(false)

    const pending = source.silence('1:aaaa')

    expect(source.signals.value).toEqual([])
    expect(source.silenced.value.map((entry) => entry.signal.label)).toContain('PostgresDown')

    await pending
    expect(writes).toEqual([{ id: '1:aaaa', silenced: true }])
  })

  it('moves a line back the moment it is restored', async () => {
    const source = await open(false)

    const pending = source.restore('1:bbbb')

    expect(source.signals.value.map((entry) => entry.label)).toContain('CertExpiring')

    await pending
    expect(writes).toEqual([{ id: '1:bbbb', silenced: false }])
  })

  // An api older than the bundle in front of it answers without the silences at all, and reading
  // through a missing one would take the whole page down over a line it would draw as empty.
  it('carries the server’s count of what is firing', async () => {
    const { total } = await open(false)

    expect(total.value).toBe(1)
  })

  // The count is of what is firing and not quietened, so it moves with the line rather than
  // waiting for the next poll to correct itself.
  it('moves the count with a line that is silenced or restored', async () => {
    const source = await open(false)

    await source.silence('1:aaaa')
    expect(source.total.value).toBe(0)

    await source.restore('1:aaaa')
    expect(source.total.value).toBe(1)
  })

  // Pressing the same control twice must not walk the count away from the truth.
  it('leaves the count alone when nothing actually changed sides', async () => {
    const source = await open(false)

    await source.silence('1:bbbb')

    expect(source.total.value).toBe(1)
  })

  // A silence refused because the session ended is the same lapse the polls report, and is said
  // the same way rather than only warned about.
  it('reports a lapse when a silence answers 401', async () => {
    const { silence } = await open(false)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 401 }))),
    )

    await silence('1:aaaa')

    expect(sessionLapsed.value).toBe(true)
  })

  it('does not take a refused silence for a lapse', async () => {
    const { silence } = await open(false)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 403 }))),
    )

    await silence('1:aaaa')

    expect(sessionLapsed.value).toBe(false)
  })

  it('survives a payload that carries no silences at all', async () => {
    vi.stubGlobal('fetch', stubApi({ signals: PAYLOAD.signals, pollSeconds: 60 }))

    const { signals, silenced, total } = await open(false)

    expect(signals.value).toHaveLength(3)
    expect(silenced.value).toEqual([])
    // No count served, so what arrived is the honest answer
    expect(total.value).toBe(3)
  })
})
