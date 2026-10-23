import assert from 'node:assert/strict'
import { existsSync, statSync } from 'node:fs'
import { after, before, test } from 'node:test'
import type { ApiHistory, ApiHistoryEntry, ApiHistoryState, ApiHistoryVisits } from '@diele/common'
import { startApi, type TestApi } from '#tests/support/harness.js'

let api: TestApi
let historyDbPath: string
let whenIngested: () => Promise<void>
let userId: number

before(async () => {
  api = await startApi({ AUTH_MODE: 'dev' })
  await api.signIn()

  const { config } = await import('#config.js')
  historyDbPath = config.history.dbPath
  ;({ whenIngested } = await import('#history/ingest.js'))
  userId = (await api.get<{ id: number }>('/api/auth/me')).id
})

after(async () => {
  await api.close()
})

/**
 * Flips one of the admin switches the way the panel does.
 * @param {string} id - Feature to switch
 * @param {boolean} enabled - Whether it should be on
 * @returns {Promise<void>}
 */
async function setSwitch(id: string, enabled: boolean): Promise<void> {
  const response = await api.request(`/api/admin/features/${id}/enabled`, {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  })

  assert.equal(response.status, 200)
}

/**
 * Writes the account's preferences.
 * @param {unknown} body - What to send
 * @returns {Promise<Response>} - The response
 */
function putPreferences(body: unknown): Promise<Response> {
  return api.request('/api/history/preferences', { method: 'PUT', body: JSON.stringify(body) })
}

/**
 * Posts a batch of visits and waits for the background work it started.
 * @param {ApiHistoryVisits} batch - What to send
 * @returns {Promise<number>} - The status it was answered with
 */
async function postVisits(batch: ApiHistoryVisits): Promise<number> {
  const response = await api.request('/api/history/visits', {
    method: 'POST',
    body: JSON.stringify(batch),
  })

  await whenIngested()
  return response.status
}

/**
 * Reads the management list.
 * @returns {Promise<ReadonlyArray<ApiHistoryEntry>>} - Every entry of the account
 */
async function allEntries(): Promise<ReadonlyArray<ApiHistoryEntry>> {
  return (await api.get<{ entries: ApiHistoryEntry[] }>('/api/history/entries')).entries
}

// First, because it is the only test that needs a portal nobody has switched anything on yet.
test('a portal that never turned history on serves the state and creates no file', async () => {
  const payload = await api.get<ApiHistory>('/api/history')

  assert.deepEqual(payload, {
    state: {
      available: false,
      sources: { diele: false, extension: false },
      enabled: false,
      excludedDomains: [],
      kept: 0,
    },
    entries: [],
  })
  assert.deepEqual(await api.get<ApiHistoryState>('/api/history/state'), payload.state)
  assert.deepEqual(await allEntries(), [])
  assert.equal(existsSync(historyDbPath), false)

  const { readHistoryKey } = await import('#users/historyKey.js')
  assert.equal(readHistoryKey(userId), undefined)
})

// A copy in any cache outlives the delete that removed the entries from the database.
test('nothing under the history may be stored by a cache', async () => {
  for (const path of ['/api/history', '/api/history/state', '/api/history/entries']) {
    assert.equal((await api.request(path)).headers.get('cache-control'), 'no-store', path)
  }

  const refused = await api.request('/api/history/visits', {
    method: 'POST',
    body: JSON.stringify({ source: 'extension', visits: [] }),
  })
  assert.equal(refused.headers.get('cache-control'), 'no-store')
})

test('the switches are admin features, off by default, the sources inside the feature', async () => {
  const { features } = await api.get<{
    features: ReadonlyArray<{
      id: string
      enabled?: boolean
      switchOnly?: boolean
      parent?: string
    }>
  }>('/api/admin/features')
  const byId = new Map(features.map((feature) => [feature.id, feature]))

  for (const id of ['history', 'historyDiele', 'historyExtension']) {
    assert.equal(byId.get(id)?.enabled, false, id)
    assert.equal(byId.get(id)?.switchOnly, true, id)
  }

  assert.equal(byId.get('history')?.parent, undefined)
  assert.equal(byId.get('historyDiele')?.parent, 'history')
  assert.equal(byId.get('historyExtension')?.parent, 'history')
})

// 403 and never 401: the portal reads a 401 as a lapsed session and sends the person to sign in.
test('a visit is refused until the feature, the source and the account all say yes', async () => {
  const batch: ApiHistoryVisits = { source: 'extension', visits: [{ url: 'https://a.example/' }] }

  assert.equal(await postVisits(batch), 403)

  await setSwitch('history', true)
  assert.equal(await postVisits(batch), 403)

  await setSwitch('historyExtension', true)
  assert.equal(await postVisits(batch), 403)

  assert.equal((await putPreferences({ enabled: true })).status, 200)
  assert.equal(await postVisits(batch), 200)

  // The file is the account's history and is created readable by this process alone.
  assert.equal(statSync(historyDbPath).mode & 0o777, 0o600)
  const { readHistoryKey } = await import('#users/historyKey.js')
  assert.match(readHistoryKey(userId) ?? '', /^[\w-]{22}$/)

  // A source switched on beneath a feature switched off accepts nothing.
  await setSwitch('history', false)
  assert.equal(await postVisits(batch), 403)
  assert.equal((await api.get<ApiHistory>('/api/history')).state.sources.extension, false)

  await setSwitch('history', true)
  assert.equal(await postVisits({ ...batch, source: 'diele' }), 403)
})

// The extension tells accounts apart by it, so it has to be stable and give nothing away.
test('the state alone carries what is kept and an opaque tag for the account', async () => {
  const { readHistoryKey } = await import('#users/historyKey.js')
  const key = readHistoryKey(userId) ?? ''
  const state = await api.get<ApiHistoryState>('/api/history/state')
  const { state: full } = await api.get<ApiHistory>('/api/history')

  assert.deepEqual(state, full)
  assert.equal(state.kept, (await allEntries()).length)
  assert.match(state.account ?? '', /^[\w-]{22}$/)
  assert.notEqual(state.account, key)
  assert.equal(JSON.stringify(state).includes(key), false)
  assert.equal((await api.get<ApiHistoryState>('/api/history/state')).account, state.account)
})

test('what is kept is the stripped url, and what is not worth keeping is dropped', async () => {
  await api.request('/api/history/entries', { method: 'DELETE' })

  const status = await postVisits({
    source: 'extension',
    visits: [
      { url: 'https://grafana.example/d/abc/overview?orgId=1#panel', title: 'Overview' },
      { url: 'https://www.google.com/search?q=private' },
      { url: 'http://localhost:5173/' },
      { url: 'http://portal.test/admin' },
      { url: 'https://app.example/reset/Xk9fQ2mZ7pL4wR8tY1vB6nC3hJ5sD0gA' },
    ],
  })

  assert.equal(status, 200)
  const entries = await allEntries()

  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.url, 'https://grafana.example/d/abc/overview')
  assert.equal(entries[0]?.title, 'Overview')
  assert.equal(entries[0]?.visits, 1)
})

test('a visit to a known url counts towards it rather than adding a line', async () => {
  await postVisits({
    source: 'extension',
    visits: [{ url: 'https://grafana.example/d/abc/overview/' }],
  })

  const entries = await allEntries()
  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.visits, 2)
})

// 4xx and never 401, so the portal does not read it as a lapsed session.
test('a batch past what the account may have in flight is answered 429', async () => {
  const { startIngest } = await import('#history/ingest.js')
  const { readHistoryKey } = await import('#users/historyKey.js')
  const owner = readHistoryKey(userId) ?? ''
  const held: Array<() => void> = []
  const hold = (): Promise<ReadonlyArray<string>> =>
    new Promise((resolve) => {
      held.push(() => resolve(['93.184.216.34']))
    })
  const batch: ApiHistoryVisits = { source: 'extension', visits: [] }

  assert.equal(
    startIngest(
      owner,
      { source: 'diele', visits: [{ url: 'https://h1.example/' }] },
      { resolve: hold },
    ),
    true,
  )
  assert.equal(
    startIngest(
      owner,
      { source: 'diele', visits: [{ url: 'https://h2.example/' }] },
      { resolve: hold },
    ),
    true,
  )

  const refused = await api.request('/api/history/visits', {
    method: 'POST',
    body: JSON.stringify(batch),
  })
  assert.equal(refused.status, 429)

  let settled = false
  void whenIngested().then(() => {
    settled = true
  })

  while (!settled) {
    held.shift()?.()
    await new Promise((resolve) => setImmediate(resolve))
  }

  assert.equal(await postVisits(batch), 200)
})

test('a batch that does not hold together is refused whole', async () => {
  const tooMany = Array.from({ length: 201 }, (_, index) => ({ url: `https://x.example/${index}` }))

  assert.equal(await postVisits({ source: 'extension', visits: tooMany }), 400)
  assert.equal(await postVisits({ source: 'diele', visits: tooMany.slice(0, 21) }), 400)
  assert.equal(
    await postVisits({ source: 'nonsense', visits: [] } as unknown as ApiHistoryVisits),
    400,
  )
  assert.equal(
    await postVisits({
      source: 'extension',
      visits: [{ url: 'https://x.example/', at: 'yesterday' }],
    }),
    400,
  )
})

test('a write from another origin is turned away like every other write', async () => {
  const response = await api.request('/api/history/entries', {
    method: 'DELETE',
    headers: { origin: 'https://evil.example' },
  })

  assert.equal(response.status, 403)
  assert.equal((await allEntries()).length, 1)
})

test('the portal is not offered a page it already shows as a card or saved site', async () => {
  await postVisits({
    source: 'extension',
    visits: [{ url: 'https://wiki.example/start' }, { url: 'https://chat.example/' }],
  })

  await api.post('/api/admin/links/card', {
    label: 'Wiki',
    url: 'https://wiki.example/start/?ref=card',
  })
  await api.post('/api/admin/links/site', { label: 'Chat', url: 'https://chat.example' })

  const served = (await api.get<ApiHistory>('/api/history')).entries.map((entry) => entry.url)

  assert.deepEqual(served, ['https://grafana.example/d/abc/overview'])
  assert.equal((await allEntries()).length, 3)

  // A section switched off offers nothing, so its pages are history like any other.
  await setSwitch('sites', false)
  const unshadowed = (await api.get<ApiHistory>('/api/history')).entries.map((entry) => entry.url)
  await setSwitch('sites', true)

  assert.deepEqual(unshadowed.sort(), [
    'https://chat.example/',
    'https://grafana.example/d/abc/overview',
  ])
})

// Switching off stops recording and serving, and nothing else.
test('switching the feature off empties what is served and deletes nothing', async () => {
  await setSwitch('history', false)

  assert.deepEqual((await api.get<ApiHistory>('/api/history')).entries, [])
  assert.equal((await allEntries()).length, 3)

  await setSwitch('history', true)
  assert.equal((await api.get<ApiHistory>('/api/history')).entries.length, 1)
})

test('opting out stops serving and keeps what was there', async () => {
  const state = (await (await putPreferences({ enabled: false })).json()) as ApiHistoryState

  assert.equal(state.enabled, false)
  assert.deepEqual((await api.get<ApiHistory>('/api/history')).entries, [])
  assert.equal((await allEntries()).length, 3)

  await putPreferences({ enabled: true })
})

test('excluding a domain forgets what was kept on it and its subdomains', async () => {
  await postVisits({
    source: 'extension',
    visits: [
      { url: 'https://bank.example/accounts' },
      { url: 'https://online.bank.example/transfer' },
      { url: 'https://notbank.example/' },
    ],
  })

  const response = await putPreferences({
    excludedDomains: ['HTTPS://Bank.Example/login', 'bank.example'],
  })
  const state = (await response.json()) as ApiHistoryState

  assert.equal(response.status, 200)
  assert.deepEqual(state.excludedDomains, ['bank.example'])
  assert.equal(state.enabled, true)

  const urls = (await allEntries()).map((entry) => entry.url)
  assert.equal(urls.includes('https://bank.example/accounts'), false)
  assert.equal(urls.includes('https://online.bank.example/transfer'), false)
  assert.equal(urls.includes('https://notbank.example/'), true)

  await postVisits({ source: 'extension', visits: [{ url: 'https://bank.example/again' }] })
  assert.equal(
    (await allEntries()).some((entry) => entry.url.includes('bank.example/again')),
    false,
  )
})

test('a domain that is not a hostname, or too many of them, is refused', async () => {
  assert.equal((await putPreferences({ excludedDomains: ['not a domain'] })).status, 400)
  assert.equal(
    (
      await putPreferences({
        excludedDomains: Array.from({ length: 201 }, (_, i) => `d${i}.example`),
      })
    ).status,
    400,
  )
  assert.deepEqual((await api.get<ApiHistory>('/api/history')).state.excludedDomains, [
    'bank.example',
  ])
})

test('one entry can be deleted, and only one the account holds', async () => {
  const [first] = await allEntries()
  assert.ok(first)

  const removed = await api.request(`/api/history/entries/${first.id}`, { method: 'DELETE' })
  assert.equal(removed.status, 200)
  assert.equal(
    (await allEntries()).some((entry) => entry.id === first.id),
    false,
  )

  const again = await api.request(`/api/history/entries/${first.id}`, { method: 'DELETE' })
  assert.equal(again.status, 404)

  // Someone else's entry answers exactly like one that does not exist, and stays.
  const { recordVisit } = await import('#history/record.js')
  const { listEntries } = await import('#history/entries.js')
  recordVisit(
    'someone-else',
    { url: 'https://theirs.example/', at: new Date().toISOString() },
    'extension',
  )
  const [theirs] = listEntries('someone-else')
  assert.ok(theirs)

  const foreign = await api.request(`/api/history/entries/${theirs.id}`, { method: 'DELETE' })
  assert.equal(foreign.status, 404)
  assert.deepEqual(await foreign.json(), await again.json())
  assert.equal(listEntries('someone-else').length, 1)

  const malformed = await api.request('/api/history/entries/abc', { method: 'DELETE' })
  assert.equal(malformed.status, 400)
})

// A shell only ever shows up as its origin, so deleting the origin is how it is forgotten.
test('deleting an origin entry forgets the shells folded into it, and only those', async () => {
  const { getHistoryDb } = await import('#history/db.js')
  const { readHistoryKey } = await import('#users/historyKey.js')
  const owner = readHistoryKey(userId) ?? ''
  const shells = (): string[] =>
    (
      getHistoryDb()
        .prepare('SELECT url FROM history_shells WHERE owner = ? ORDER BY url')
        .all(owner) as Array<{ url: string }>
    ).map((row) => row.url)

  for (const site of ['tube.example', 'other-tube.example']) {
    for (const [index, title] of ['One', 'Two', 'Three'].entries()) {
      await postVisits({
        source: 'extension',
        visits: [{ url: `https://${site}/watch?v=${index}`, title }],
      })
    }
  }

  assert.deepEqual(shells(), ['https://other-tube.example/watch', 'https://tube.example/watch'])

  // Lookalikes of the origin, and the same origin under someone else, are not its shells.
  const insert = getHistoryDb().prepare('INSERT INTO history_shells (owner, url) VALUES (?, ?)')
  for (const url of [
    'https://tube.example/Clip',
    'https://tube.example:8443/watch',
    'https://tube.example.evil/watch',
    'http://tube.example/watch',
  ]) {
    insert.run(owner, url)
  }
  insert.run('someone-else', 'https://tube.example/watch')

  const origin = (await allEntries()).find((entry) => entry.url === 'https://tube.example/')
  assert.ok(origin)

  const removed = await api.request(`/api/history/entries/${origin.id}`, { method: 'DELETE' })
  assert.equal(removed.status, 200)
  assert.deepEqual(shells(), [
    'http://tube.example/watch',
    'https://other-tube.example/watch',
    'https://tube.example.evil/watch',
    'https://tube.example:8443/watch',
  ])
  assert.ok(
    getHistoryDb()
      .prepare('SELECT 1 FROM history_shells WHERE owner = ? AND url = ?')
      .get('someone-else', 'https://tube.example/watch'),
  )

  // No longer a shell, the page is an entry of its own again.
  await postVisits({ source: 'extension', visits: [{ url: 'https://tube.example/watch?v=9' }] })
  assert.ok((await allEntries()).some((entry) => entry.url === 'https://tube.example/watch'))
})

test('clearing removes every entry and keeps the preferences', async () => {
  const response = await api.request('/api/history/entries', { method: 'DELETE' })

  assert.equal(response.status, 200)
  assert.deepEqual(await allEntries(), [])

  const { state } = await api.get<ApiHistory>('/api/history')
  assert.equal(state.enabled, true)
  assert.deepEqual(state.excludedDomains, ['bank.example'])
})

// The history file is not configuration: an export does not carry it and an import leaves it be.
test('an export carries none of it and an import leaves it standing', async () => {
  await postVisits({ source: 'extension', visits: [{ url: 'https://kept.example/' }] })

  const exported = await api.get<Record<string, unknown>>('/api/admin/export')
  assert.equal(JSON.stringify(exported).includes('kept.example'), false)

  const imported = await api.request('/api/admin/import', {
    method: 'POST',
    body: JSON.stringify(exported),
  })
  assert.equal(imported.status, 200)

  assert.deepEqual(
    (await allEntries()).map((entry) => entry.url),
    ['https://kept.example/'],
  )
})

// A deleted row is overwritten on disk rather than left in a free page or the log.
test('the history connection overwrites what it deletes', async () => {
  const { getHistoryDb } = await import('#history/db.js')

  assert.equal(getHistoryDb().pragma('secure_delete', { simple: true }), 1)
})

test('the history needs a session', async () => {
  api.forgetCookies()

  assert.equal((await api.request('/api/history')).status, 401)
  assert.equal((await api.request('/api/history/entries')).status, 401)

  await api.signIn()
})
