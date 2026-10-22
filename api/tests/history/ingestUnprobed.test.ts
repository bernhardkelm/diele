import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { startApi, type TestApi } from '#tests/support/harness.js'

let api: TestApi

before(async () => {
  api = await startApi({ AUTH_MODE: 'dev', HISTORY_PROBE: 'false' })
})

after(async () => {
  await api.close()
})

// For a deployment that would rather not send this server's address to every site its people
// open: a public page is kept as reported, and what must never be reached is still dropped.
test('with probing off a public page is kept unprobed, loopback by name still dropped', async () => {
  await api.signIn()
  const { id } = await api.get<{ id: number }>('/api/auth/me')

  const { ensureHistoryKey } = await import('#users/historyKey.js')
  const { writePreferences } = await import('#history/preferences.js')
  const { ingestVisits } = await import('#history/ingest.js')
  const { listEntries } = await import('#history/entries.js')

  for (const feature of ['history', 'historyDiele']) {
    await api.request(`/api/admin/features/${feature}/enabled`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: true }),
    })
  }

  const owner = ensureHistoryKey(id)
  writePreferences(owner, { enabled: true, excludedDomains: [] })

  const probed: string[] = []
  await ingestVisits(
    owner,
    {
      source: 'diele',
      visits: [{ url: 'https://public.example/' }, { url: 'http://localhost:8080/' }],
    },
    {
      resolve: async () => ['93.184.216.34'],
      exists: async (url) => {
        probed.push(url)
        return false
      },
    },
  )

  assert.deepEqual(probed, [])
  assert.deepEqual(
    listEntries(owner).map((entry) => entry.url),
    ['https://public.example/'],
  )
})
