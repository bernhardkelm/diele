import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { ApiSignals } from '@diele/common'
import { startApi, type TestApi } from '#tests/support/harness.js'

let api: TestApi

before(async () => {
  api = await startApi({ AUTH_MODE: 'dev' })
})

after(async () => {
  await api.close()
})

// Something being wrong is what everyone in the house wants to know, so this is not admin-gated.
// What an admin gets on top is the `detail`, which is narrowed in the cache rather than here.
test('the signals need a session and nothing more', async () => {
  api.forgetCookies()
  assert.equal((await api.request('/api/signals')).status, 401)

  await api.signIn()
  assert.equal((await api.request('/api/signals')).status, 200)
})

test('a portal with no source configured answers with nothing firing', async () => {
  await api.signIn()

  const payload = await api.get<ApiSignals>('/api/signals')

  assert.deepEqual(payload.signals, [])
  assert.equal(typeof payload.pollSeconds, 'number')
  assert.ok(payload.pollSeconds > 0)
})

interface FeatureList {
  readonly features: ReadonlyArray<{ id: string; enabled?: boolean; switchOnly?: boolean }>
}

/**
 * Flips the alerts switch the way the panel does.
 * @param {boolean} enabled - Whether the portal should offer it
 * @returns {Promise<Response>} - The response, so a caller can assert on its status
 */
function setAlerts(enabled: boolean): Promise<Response> {
  return api.request('/api/admin/features/alerts/enabled', {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  })
}

test('the feature is one the panel can switch off, and defaults on', async () => {
  await api.signIn()

  const { features } = await api.get<FeatureList>('/api/admin/features')
  const alerts = features.find((feature) => feature.id === 'alerts')

  assert.equal(alerts?.enabled, true)
  assert.equal(alerts?.switchOnly, true)

  assert.equal((await setAlerts(false)).status, 200)

  const off = await api.get<FeatureList>('/api/admin/features')
  assert.equal(off.features.find((feature) => feature.id === 'alerts')?.enabled, false)

  await setAlerts(true)
})

// Anyone signed in may silence a line, so the id they send is the bound on what this table can
// grow to. Nothing is firing on a portal with no source, so nothing may be silenced.
test('a silence for a signal nothing is reporting is refused', async () => {
  await api.signIn()

  const response = await api.request('/api/signals/silence', {
    method: 'PUT',
    body: JSON.stringify({ id: 'made-up', silenced: true }),
  })

  assert.equal(response.status, 400)
})

// The shape is not the check: an id that looks exactly like one a source builds is still refused
// while no source is reporting it, since a caller can satisfy a shape by counting.
test('an id shaped like a real one is refused just the same', async () => {
  await api.signIn()

  const response = await api.request('/api/signals/silence', {
    method: 'PUT',
    body: JSON.stringify({ id: '1:deadbeef', silenced: true }),
  })

  assert.equal(response.status, 400)

  const rows = await api.get<ApiSignals>('/api/signals')
  assert.deepEqual(rows.signals, [])
})

test('a silence still needs a session', async () => {
  api.forgetCookies()

  const response = await api.request('/api/signals/silence', {
    method: 'PUT',
    body: JSON.stringify({ id: '1:deadbeef', silenced: true }),
  })

  assert.equal(response.status, 401)
})
