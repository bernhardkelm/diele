import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { startApi, type TestApi } from '#tests/support/harness.js'

const DAY = 24 * 60 * 60_000

let api: TestApi
let owner: string
let pruneHistory: typeof import('#history/prune.js').pruneHistory
let recordVisit: typeof import('#history/record.js').recordVisit
let listEntries: typeof import('#history/entries.js').listEntries
let clearEntries: typeof import('#history/entries.js').clearEntries
let writePreferences: typeof import('#history/preferences.js').writePreferences
let readPreferences: typeof import('#history/preferences.js').readPreferences

/**
 * Records visits to a url, the last one some days ago.
 * @param {string} url - Url in stored form
 * @param {number} visits - How many
 * @param {number} daysAgo - When they happened
 * @param {string} key - Account they belong to
 * @returns {void}
 */
function visit(url: string, visits: number, daysAgo: number, key = owner): void {
  for (let index = 0; index < visits; index += 1) {
    recordVisit(key, { url, at: new Date(Date.now() - daysAgo * DAY).toISOString() })
  }
}

/**
 * Lists the urls an account holds.
 * @param {string} key - Account to read
 * @returns {string[]} - Urls, sorted
 */
function urls(key = owner): string[] {
  return listEntries(key)
    .map((entry) => entry.url)
    .sort()
}

/**
 * Flips the feature switch the way the panel does.
 * @param {boolean} enabled - Whether it should be on
 * @returns {Promise<void>}
 */
async function setHistory(enabled: boolean): Promise<void> {
  await api.request('/api/admin/features/history/enabled', {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  })
}

before(async () => {
  api = await startApi({ AUTH_MODE: 'dev', HISTORY_MAX_ENTRIES: '3', HISTORY_ONE_OFF_DAYS: '14' })
  await api.signIn()
  const { id } = await api.get<{ id: number }>('/api/auth/me')
  owner = (await import('#users/historyKey.js')).ensureHistoryKey(id)

  ;({ pruneHistory } = await import('#history/prune.js'))
  ;({ recordVisit } = await import('#history/record.js'))
  ;({ listEntries, clearEntries } = await import('#history/entries.js'))
  ;({ writePreferences, readPreferences } = await import('#history/preferences.js'))

  await setHistory(true)
})

beforeEach(() => {
  clearEntries(owner)
})

after(async () => {
  await api.close()
})

test('a page visited once expires after the one-off window, one visited twice does not', () => {
  visit('https://once-old.example/', 1, 15)
  visit('https://once-new.example/', 1, 13)
  visit('https://twice-old.example/', 2, 15)

  pruneHistory()

  assert.deepEqual(urls(), ['https://once-new.example/', 'https://twice-old.example/'])
})

test('beyond the cap, the least recently visited go first', () => {
  visit('https://a.example/', 5, 10)
  visit('https://b.example/', 5, 3)
  visit('https://c.example/', 5, 2)
  visit('https://d.example/', 5, 1)

  pruneHistory()

  assert.deepEqual(urls(), ['https://b.example/', 'https://c.example/', 'https://d.example/'])
})

test('the cap is per account', () => {
  const other = 'other-account-key'
  visit('https://mine.example/', 2, 2)

  for (const name of ['a', 'b', 'c']) {
    visit(`https://${name}.other.example/`, 2, 1, other)
  }

  pruneHistory()

  assert.deepEqual(urls(), ['https://mine.example/'])
})

// Nothing cascades across the two files, so the prune is what catches an account deleted, or a
// configuration restored from before the account existed.
test('rows filed under a key no account holds are swept', () => {
  const ghost = 'key-of-a-deleted-account'
  visit('https://ghost.example/', 2, 1, ghost)
  writePreferences(ghost, { enabled: true, excludedDomains: ['x.example'] })
  visit('https://mine.example/', 2, 1)

  pruneHistory()

  assert.deepEqual(urls(ghost), [])
  assert.equal(readPreferences(ghost).enabled, false)
  assert.deepEqual(urls(), ['https://mine.example/'])
})

// Switching off stops recording and serving and nothing else, but rows no account holds are not
// anything an account kept, so they go whatever the switch says.
test('while the feature is off only the orphans are swept', async () => {
  visit('https://once-old.example/', 1, 30)
  visit('https://ghost.example/', 2, 1, 'key-of-a-deleted-account')
  await setHistory(false)

  pruneHistory()
  assert.deepEqual(urls(), ['https://once-old.example/'])
  assert.deepEqual(urls('key-of-a-deleted-account'), [])

  await setHistory(true)
  pruneHistory()
  assert.deepEqual(urls(), [])
})

// The insert holds the cap as it writes; the prune holds it for rows written any other way.
test('beyond the shell cap, the oldest shells go first', async () => {
  const { getHistoryDb } = await import('#history/db.js')
  const db = getHistoryDb()
  const insert = db.prepare('INSERT INTO history_shells (owner, url) VALUES (?, ?)')

  for (const name of ['first', 'second', 'third']) {
    insert.run(owner, `https://${name}.example/watch`)
  }

  pruneHistory()

  const left = db.prepare('SELECT url FROM history_shells WHERE owner = ?').all(owner) as Array<{
    url: string
  }>
  assert.deepEqual(
    left.map((row) => row.url),
    ['https://third.example/watch'],
  )
})
