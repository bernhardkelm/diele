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
    recordVisit(key, { url, at: new Date(Date.now() - daysAgo * DAY).toISOString() }, 'extension')
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
  writePreferences(owner, { enabled: true, excludedDomains: [] })
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
  writePreferences(other, { enabled: true, excludedDomains: [] })
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

// Switching off never deletes, and an account opting out is switching off for itself.
test('an account that opted out keeps what it has past the one-off window and the cap', () => {
  writePreferences(owner, { enabled: false, excludedDomains: [] })
  visit('https://once-old.example/', 1, 30)
  for (const name of ['a', 'b', 'c', 'd']) {
    visit(`https://${name}.example/`, 2, 1)
  }

  pruneHistory()
  assert.equal(urls().length, 5)

  writePreferences(owner, { enabled: true, excludedDomains: [] })
  pruneHistory()
  assert.equal(urls().length, 3)
})

/**
 * Reads how many frames the write-ahead log holds.
 * @returns {Promise<number>} - Frames in the log, 0 once it was truncated
 */
async function walFrames(): Promise<number> {
  const { getHistoryDb } = await import('#history/db.js')
  const [row] = getHistoryDb().pragma('wal_checkpoint(PASSIVE)') as Array<{ log: number }>

  return row?.log ?? 0
}

// Until the log is folded in and truncated, it still holds the rows the prune just removed.
test('a prune that removed anything truncates the log', async () => {
  visit('https://once-old.example/', 1, 30)
  assert.ok((await walFrames()) > 0)

  pruneHistory()

  assert.deepEqual(urls(), [])
  assert.equal(await walFrames(), 0)
})

/**
 * Sets every account's history key in the main database, the way a restore would leave it.
 * @param {string | null} key - Key to set, null for none
 * @returns {Promise<Array<{ id: number; history_key: string | null }>>} - The keys as they were
 */
async function setAllKeys(
  key: string | null,
): Promise<Array<{ id: number; history_key: string | null }>> {
  const { getDb } = await import('#db/index.js')
  const before = getDb().prepare('SELECT id, history_key FROM users').all() as Array<{
    id: number
    history_key: string | null
  }>

  getDb().prepare('UPDATE users SET history_key = ?').run(key)
  return before
}

/**
 * Puts the keys back as they were.
 * @param {Array<{ id: number; history_key: string | null }>} rows - What `setAllKeys` returned
 * @returns {Promise<void>}
 */
async function restoreKeys(rows: Array<{ id: number; history_key: string | null }>): Promise<void> {
  const { getDb } = await import('#db/index.js')
  const update = getDb().prepare('UPDATE users SET history_key = ? WHERE id = ?')

  for (const row of rows) {
    update.run(row.history_key, row.id)
  }
}

// A main database restored from before history, or the wrong one, would otherwise empty the file.
test('the sweep is skipped, and said once, when no account holds a key at all', async (t) => {
  const warn = t.mock.method(console, 'warn', () => undefined)
  visit('https://mine.example/', 2, 1)
  const saved = await setAllKeys(null)

  pruneHistory()
  pruneHistory()
  await restoreKeys(saved)

  assert.deepEqual(urls(), ['https://mine.example/'])
  assert.equal(warn.mock.callCount(), 1)
  assert.equal(String(warn.mock.calls[0]?.arguments[0]).includes(owner), false)

  // A sweep that runs again rearms the message for the next time.
  pruneHistory()
  assert.equal(warn.mock.callCount(), 1)
})

test('the sweep is skipped when it would remove every owner there is', async (t) => {
  const warn = t.mock.method(console, 'warn', () => undefined)
  visit('https://mine.example/', 2, 1)
  const saved = await setAllKeys('a-key-the-file-has-never-seen')

  pruneHistory()
  await restoreKeys(saved)

  assert.deepEqual(urls(), ['https://mine.example/'])
  assert.equal(warn.mock.callCount(), 1)

  // With one owner held again, the ghosts go as before.
  visit('https://ghost.example/', 2, 1, 'key-of-a-deleted-account')
  pruneHistory()
  assert.deepEqual(urls('key-of-a-deleted-account'), [])
  assert.deepEqual(urls(), ['https://mine.example/'])
})

/**
 * Reads since when the file has found every owner unheld, as stored.
 * @returns {Promise<number | undefined>} - Ms since the epoch, or undefined when no wait is running
 */
async function unheldSince(): Promise<number | undefined> {
  const { getHistoryDb } = await import('#history/db.js')
  const value = getHistoryDb()
    .prepare("SELECT value FROM history_meta WHERE key = 'orphans.unheldSince'")
    .pluck()
    .get() as string | undefined

  return value === undefined ? undefined : Number(value)
}

// The last account that used history may really be gone, so the wait ends.
test('the wait survives a restart, and after thirty days the sweep runs, said first', async (t) => {
  const warn = t.mock.method(console, 'warn', () => undefined)
  const { closeHistoryDb } = await import('#history/db.js')
  visit('https://mine.example/', 2, 1)
  const saved = await setAllKeys('a-key-the-file-has-never-seen')
  const start = Date.now()

  pruneHistory(start)
  assert.equal(await unheldSince(), start)

  closeHistoryDb()
  pruneHistory(start + 29 * DAY)
  assert.deepEqual(urls(), ['https://mine.example/'])
  assert.equal(await unheldSince(), start)

  pruneHistory(start + 31 * DAY)
  await restoreKeys(saved)

  assert.deepEqual(urls(), [])
  assert.equal(await unheldSince(), undefined)
  const said = warn.mock.calls.map((call) => String(call.arguments[0]))
  assert.ok(said.some((line) => line.includes('sweeping')))
  assert.ok(said.every((line) => !line.includes(owner)))
})

test('an owner held again in the meantime starts the wait over', async () => {
  visit('https://mine.example/', 2, 1)
  const start = Date.now()

  let saved = await setAllKeys('a-key-the-file-has-never-seen')
  pruneHistory(start)
  await restoreKeys(saved)

  pruneHistory(start + 20 * DAY)
  assert.equal(await unheldSince(), undefined)

  saved = await setAllKeys('a-key-the-file-has-never-seen')
  pruneHistory(start + 35 * DAY)
  await restoreKeys(saved)

  assert.deepEqual(urls(), ['https://mine.example/'])
  assert.equal(await unheldSince(), start + 35 * DAY)

  pruneHistory()
  assert.equal(await unheldSince(), undefined)
})
