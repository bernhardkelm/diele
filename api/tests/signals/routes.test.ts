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
