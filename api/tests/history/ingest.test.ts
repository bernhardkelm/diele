import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { ApiHistoryEntry, ApiHistoryVisits } from '@diele/common'
import type { AddressClass } from '#history/addresses.js'
import { startApi, type TestApi } from '#tests/support/harness.js'

let api: TestApi
let owner: string
let ingestVisits: typeof import('#history/ingest.js').ingestVisits
let listEntries: typeof import('#history/entries.js').listEntries
let clearEntries: typeof import('#history/entries.js').clearEntries
let writePreferences: typeof import('#history/preferences.js').writePreferences

/** Every url the fake probe was asked about, in order. */
let probed: string[] = []

/** The urls the fake probe says exist. */
let real = new Set<string>()

/** Where the fake resolver says each host leads; anything unlisted is public. */
let where = new Map<string, AddressClass | undefined>()

/**
 * Stands in for resolving a host, answering from `where`.
 * @param {string} hostname - Host asked about
 * @returns {Promise<AddressClass | undefined>} - Its class
 */
async function classify(hostname: string): Promise<AddressClass | undefined> {
  return where.has(hostname) ? where.get(hostname) : 'public'
}

/**
 * Stands in for the network probe, answering from `real` and noting every question.
 * @param {string} url - Page asked about
 * @returns {Promise<boolean>} - Whether it is in `real`
 */
async function exists(url: string): Promise<boolean> {
  probed.push(url)
  return real.has(url)
}

/**
 * Runs a batch through the pipeline with the fake probe.
 * @param {ApiHistoryVisits} batch - What a source reported
 * @returns {Promise<void>}
 */
function ingest(batch: ApiHistoryVisits): Promise<void> {
  return ingestVisits(owner, batch, { classify, exists })
}

/**
 * Reads one entry by url.
 * @param {string} url - Url in stored form
 * @returns {ApiHistoryEntry | undefined} - The entry, when there is one
 */
function entryAt(url: string): ApiHistoryEntry | undefined {
  return listEntries(owner).find((entry) => entry.url === url)
}

before(async () => {
  api = await startApi({ AUTH_MODE: 'dev', HISTORY_MAX_ENTRIES: '5' })
  await api.signIn()
  const { id } = await api.get<{ id: number }>('/api/auth/me')

  ;({ ingestVisits } = await import('#history/ingest.js'))
  owner = (await import('#users/historyKey.js')).ensureHistoryKey(id)
  ;({ listEntries, clearEntries } = await import('#history/entries.js'))
  ;({ writePreferences } = await import('#history/preferences.js'))

  for (const id of ['history', 'historyDiele', 'historyExtension']) {
    await api.request(`/api/admin/features/${id}/enabled`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: true }),
    })
  }
})

beforeEach(() => {
  clearEntries(owner)
  writePreferences(owner, { enabled: true, excludedDomains: [] })
  probed = []
  real = new Set()
  where = new Map()
})

after(async () => {
  await api.close()
})

test('a page opened from the portal is kept once the probe says it exists', async () => {
  real.add('https://wiki.example/start')

  await ingest({
    source: 'diele',
    visits: [{ url: 'https://wiki.example/start?x=1' }, { url: 'https://typo.example/' }],
  })

  assert.deepEqual(probed.sort(), ['https://typo.example/', 'https://wiki.example/start'])
  assert.deepEqual(
    listEntries(owner).map((entry) => entry.url),
    ['https://wiki.example/start'],
  )
})

test('a page already kept is counted without being probed again', async () => {
  real.add('https://wiki.example/start')
  await ingest({ source: 'diele', visits: [{ url: 'https://wiki.example/start' }] })
  probed = []

  await ingest({ source: 'diele', visits: [{ url: 'https://wiki.example/start/' }] })

  assert.deepEqual(probed, [])
  assert.equal(entryAt('https://wiki.example/start')?.visits, 2)
})

test('the same unknown page twice in one batch is probed once and counted twice', async () => {
  real.add('https://wiki.example/twice')

  await ingest({
    source: 'diele',
    visits: [{ url: 'https://wiki.example/twice' }, { url: 'https://wiki.example/twice#again' }],
  })

  assert.deepEqual(probed, ['https://wiki.example/twice'])
  assert.equal(entryAt('https://wiki.example/twice')?.visits, 2)
})

// The browser saw the page load, which is a better answer than a probe from here could give.
test('the extension is believed without a probe', async () => {
  await ingest({
    source: 'extension',
    visits: [{ url: 'https://intranet.example/', title: 'Intranet' }],
  })

  assert.deepEqual(probed, [])
  assert.equal(entryAt('https://intranet.example/')?.title, 'Intranet')
})

test('an account that opts out while a probe is in flight has nothing written', async () => {
  real.add('https://slow.example/')

  await ingestVisits(
    owner,
    { source: 'diele', visits: [{ url: 'https://slow.example/' }] },
    {
      classify,
      exists: async (url) => {
        writePreferences(owner, { enabled: false, excludedDomains: [] })
        return exists(url)
      },
    },
  )

  assert.equal(entryAt('https://slow.example/'), undefined)
})

test('a reported time is held between thirty days ago and now', async () => {
  const before = Date.now()
  const recent = new Date(before - 2 * 24 * 60 * 60_000)

  await ingest({
    source: 'extension',
    visits: [
      { url: 'https://future.example/', at: '2999-01-01T00:00:00.000Z' },
      { url: 'https://ancient.example/', at: '2001-01-01T10:00:00+02:00' },
      { url: 'https://recent.example/', at: recent.toISOString() },
    ],
  })

  const future = Date.parse(entryAt('https://future.example/')?.lastVisitedAt ?? '')
  assert.ok(future >= before && future <= Date.now())

  const ancient = Date.parse(entryAt('https://ancient.example/')?.lastVisitedAt ?? '')
  const thirtyDays = 30 * 24 * 60 * 60_000
  assert.ok(ancient >= before - thirtyDays && ancient <= Date.now() - thirtyDays + 1000)

  assert.equal(entryAt('https://recent.example/')?.lastVisitedAt, recent.toISOString())
})

test('control and direction override characters are taken out of a title', async () => {
  await ingest({
    source: 'extension',
    visits: [{ url: 'https://t.example/b', title: 'Pay\u0000roll\n\u202eevil\u202c report' }],
  })

  assert.equal(entryAt('https://t.example/b')?.title, 'Pay roll evil report')
})

test('a title is trimmed and capped, an empty one leaves the stored one standing', async () => {
  await ingest({
    source: 'extension',
    visits: [{ url: 'https://t.example/a', title: `  ${'x'.repeat(400)}  ` }],
  })
  assert.equal(entryAt('https://t.example/a')?.title?.length, 300)

  await ingest({ source: 'extension', visits: [{ url: 'https://t.example/a', title: '   ' }] })
  assert.equal(entryAt('https://t.example/a')?.title?.length, 300)
})

// `/watch` with the video stripped off is not a page anyone means to go back to; the site is.
test('a url that keeps arriving with new titles is folded into its origin', async () => {
  for (const title of ['First video', 'Second video', 'Second video', 'Third video']) {
    await ingest({
      source: 'extension',
      visits: [{ url: `https://www.youtube.com/watch?v=${encodeURIComponent(title)}`, title }],
    })
  }

  assert.equal(entryAt('https://www.youtube.com/watch'), undefined)

  const origin = entryAt('https://www.youtube.com/')
  assert.equal(origin?.visits, 4)
  assert.equal(origin?.title, undefined)

  await ingest({
    source: 'extension',
    visits: [{ url: 'https://www.youtube.com/watch?v=more', title: 'Fourth video' }],
  })

  assert.equal(entryAt('https://www.youtube.com/watch'), undefined)
  assert.equal(entryAt('https://www.youtube.com/')?.visits, 5)
})

test('a folded url counts as known, so the portal does not probe it again', async () => {
  for (const title of ['One', 'Two', 'Three']) {
    await ingest({ source: 'extension', visits: [{ url: 'https://tube.example/watch', title }] })
  }

  await ingest({ source: 'diele', visits: [{ url: 'https://tube.example/watch' }] })

  assert.deepEqual(probed, [])
  assert.equal(entryAt('https://tube.example/')?.visits, 4)
})

// Two titles is a page that was renamed once, not a pattern.
test('a page renamed once keeps its own entry and its latest title', async () => {
  await ingest({
    source: 'extension',
    visits: [{ url: 'https://docs.example/guide', title: 'Guide' }],
  })
  await ingest({
    source: 'extension',
    visits: [{ url: 'https://docs.example/guide', title: 'Guide v2' }],
  })

  assert.equal(entryAt('https://docs.example/guide')?.title, 'Guide v2')
  assert.equal(entryAt('https://docs.example/'), undefined)
})

test('the root of a site is never folded into itself', async () => {
  for (const title of ['A', 'B', 'C', 'D']) {
    await ingest({ source: 'extension', visits: [{ url: 'https://news.example/', title }] })
  }

  assert.equal(entryAt('https://news.example/')?.visits, 4)
  assert.equal(entryAt('https://news.example/')?.title, 'D')
})

test('a visit on an excluded domain is dropped before anything is probed', async () => {
  writePreferences(owner, { enabled: true, excludedDomains: ['bank.example'] })

  await ingest({ source: 'diele', visits: [{ url: 'https://online.bank.example/' }] })

  assert.deepEqual(probed, [])
  assert.deepEqual(listEntries(owner), [])
})

test('a search page of an engine configured in diele is dropped', async () => {
  const created = await api.post<{ engine: { id: number } }>('/api/admin/engines', {
    name: 'Intranet search',
    urlTemplate: 'https://find.example/s?term={query}',
  })
  assert.ok(created.engine.id > 0)

  await ingest({ source: 'extension', visits: [{ url: 'https://find.example/s?term=payroll' }] })

  assert.deepEqual(listEntries(owner), [])
})

// The server's network is not the visitor's, so asking it what answers there would only tell the
// visitor something about this server's surroundings. Kept unprobed; the one-off prune clears a typo.
test('a page on a private network is kept without being probed', async () => {
  where.set('nas.lan', 'private')

  await ingest({ source: 'diele', visits: [{ url: 'http://nas.lan/files' }] })

  assert.deepEqual(probed, [])
  assert.equal(entryAt('http://nas.lan/files')?.visits, 1)
})

test('a name that resolves to loopback or link-local is dropped and never probed', async () => {
  where.set('127.0.0.1.nip.io', 'loopback')
  where.set('rebind.example', 'linkLocal')

  await ingest({
    source: 'diele',
    visits: [{ url: 'http://127.0.0.1.nip.io/' }, { url: 'http://rebind.example/latest' }],
  })

  assert.deepEqual(probed, [])
  assert.deepEqual(listEntries(owner), [])
})

test('a name that does not resolve is not a page', async () => {
  where.set('typo.example', undefined)

  await ingest({ source: 'diele', visits: [{ url: 'https://typo.example/' }] })

  assert.deepEqual(probed, [])
  assert.deepEqual(listEntries(owner), [])
})

// Only the stripped url leaves this server, never the query or the credentials it arrived with.
test('the probe is sent the stored url and nothing more', async () => {
  real.add('https://wiki.example/page')

  await ingest({
    source: 'diele',
    visits: [{ url: 'https://alice:secret@wiki.example/page;jsessionid=1?token=abc#top' }],
  })

  assert.deepEqual(probed, ['https://wiki.example/page'])
})

test('a delete while a probe is in flight keeps the probe from writing anything back', async () => {
  real.add('https://late.example/')
  await ingest({ source: 'extension', visits: [{ url: 'https://other.example/' }] })

  await ingestVisits(
    owner,
    { source: 'diele', visits: [{ url: 'https://late.example/' }] },
    {
      classify,
      exists: async (url) => {
        clearEntries(owner)
        return exists(url)
      },
    },
  )

  assert.deepEqual(listEntries(owner), [])
})

test('a domain excluded while a probe is in flight is not written', async () => {
  real.add('https://soon-excluded.example/')

  await ingestVisits(
    owner,
    { source: 'diele', visits: [{ url: 'https://soon-excluded.example/' }] },
    {
      classify,
      exists: async (url) => {
        writePreferences(owner, { enabled: true, excludedDomains: ['soon-excluded.example'] })
        return exists(url)
      },
    },
  )

  assert.deepEqual(listEntries(owner), [])
})

test('the cap holds as visits are written, not only when the prune runs', async () => {
  const visits = Array.from({ length: 8 }, (_, index) => ({
    url: `https://cap.example/${index}`,
    at: new Date(Date.now() - (8 - index) * 60_000).toISOString(),
  }))

  await ingest({ source: 'extension', visits })

  assert.deepEqual(
    listEntries(owner).map((entry) => entry.url),
    [
      'https://cap.example/7',
      'https://cap.example/6',
      'https://cap.example/5',
      'https://cap.example/4',
      'https://cap.example/3',
    ],
  )
})

// Counted against this account's rows alone; another account having the url changes nothing.
test('what another account holds neither spares a probe nor counts towards a fold', async () => {
  const { recordVisit } = await import('#history/record.js')
  const other = 'another-account-key'

  recordVisit(other, { url: 'https://shared.example/page', at: new Date().toISOString() })
  for (const title of ['One', 'Two']) {
    recordVisit(other, { url: 'https://tube.example/watch', title, at: new Date().toISOString() })
  }

  real.add('https://shared.example/page')
  await ingest({ source: 'diele', visits: [{ url: 'https://shared.example/page' }] })
  await ingest({
    source: 'extension',
    visits: [{ url: 'https://tube.example/watch', title: 'Three' }],
  })

  assert.deepEqual(probed, ['https://shared.example/page'])
  assert.equal(entryAt('https://shared.example/page')?.visits, 1)
  assert.equal(entryAt('https://tube.example/watch')?.visits, 1)
})

test('a page under a slash command that carries the term in its path is dropped', async () => {
  await api.post('/api/admin/commands', {
    keyword: 'wikisearch',
    label: 'Wiki search',
    urlTemplate: 'https://wiki.example/search-path/{query}',
  })

  await ingest({
    source: 'extension',
    visits: [{ url: 'https://wiki.example/search-path/salaries' }],
  })

  assert.deepEqual(listEntries(owner), [])
})

/**
 * Counts the shell urls an account keeps.
 * @param {string} key - The account's history key
 * @returns {Promise<number>} - Number of shells
 */
async function shellCount(key: string): Promise<number> {
  const { getHistoryDb } = await import('#history/db.js')
  const row = getHistoryDb()
    .prepare('SELECT COUNT(*) AS count FROM history_shells WHERE owner = ?')
    .get(key) as { count: number }

  return row.count
}

// Without a cap of their own, folded shells would grow past every entry cap there is.
test('an account keeps a fifth of its entry cap in shells, the oldest going first', async () => {
  const { shellCap } = await import('#history/record.js')
  assert.equal(shellCap(), 1)

  for (const site of ['one', 'two', 'three']) {
    for (const title of ['A', 'B', 'C']) {
      await ingest({
        source: 'extension',
        visits: [{ url: `https://${site}.example/watch`, title }],
      })
    }
  }

  assert.equal(await shellCount(owner), 1)

  await ingest({ source: 'diele', visits: [{ url: 'https://three.example/watch' }] })
  assert.equal(entryAt('https://three.example/watch'), undefined)
  assert.equal(entryAt('https://three.example/')?.visits, 4)
})

// The portal only echoes titles this server served, so they are never news.
test('a title from the portal itself is never stored and never folds anything', async () => {
  await ingest({ source: 'extension', visits: [{ url: 'https://echo.example/page' }] })

  for (const title of ['One', 'Two', 'Three', 'Four']) {
    await ingest({ source: 'diele', visits: [{ url: 'https://echo.example/page', title }] })
  }

  const entry = entryAt('https://echo.example/page')
  assert.equal(entry?.visits, 5)
  assert.equal(entry?.title, undefined)
  assert.equal(await shellCount(owner), 0)
})

// Whether a private url is kept says whether its name resolves, so lookups are an oracle too.
test('every lookup is charged to the account, and past its budget a url is dropped', async () => {
  const budgeted = 'resolve-budget-owner'
  writePreferences(budgeted, { enabled: true, excludedDomains: [] })

  let lookups = 0
  const privateEverywhere = async (): Promise<AddressClass> => {
    lookups += 1
    return 'private'
  }

  for (let batch = 0; batch < 4; batch += 1) {
    const visits = Array.from({ length: 20 }, (_, index) => ({
      url: `http://host-${batch}-${index}.internal/`,
    }))
    await ingestVisits(
      budgeted,
      { source: 'diele', visits },
      { classify: privateEverywhere, exists },
    )
  }

  assert.equal(lookups, 60)
  assert.equal(listEntries(budgeted).length, 5)
  assert.deepEqual(probed, [])
})

test('an account may have two batches in flight and no more', async () => {
  const { startIngest, whenIngested, MAX_IN_FLIGHT } = await import('#history/ingest.js')
  const held: Array<() => void> = []
  const hold = (): Promise<AddressClass> =>
    new Promise((resolve) => {
      held.push(() => resolve('public'))
    })
  const batch: ApiHistoryVisits = { source: 'diele', visits: [{ url: 'https://held.example/' }] }

  assert.equal(MAX_IN_FLIGHT, 2)
  assert.equal(startIngest(owner, batch, { classify: hold, exists }), true)
  assert.equal(startIngest(owner, batch, { classify: hold, exists }), true)
  assert.equal(startIngest(owner, batch, { classify: hold, exists }), false)
  assert.equal(startIngest('someone-else-entirely', batch, { classify: hold, exists }), true)

  // Released as they arrive: only two lookups run at once, so the third waits for one of them.
  let settled = false
  void whenIngested().then(() => {
    settled = true
  })

  while (!settled) {
    held.shift()?.()
    await new Promise((resolve) => setImmediate(resolve))
  }

  assert.equal(startIngest(owner, batch, { classify, exists }), true)
  await whenIngested()
})
