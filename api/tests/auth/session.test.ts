import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createSession,
  deleteUserSessions,
  deleteSession,
  readSession,
  readSessionIdToken,
  touchSession,
} from '#auth/session.js'
import { config } from '#config.js'
import { getDb } from '#db/index.js'

/**
 * Creates an account to open sessions for.
 * @param {string} subject - Username, which is what makes the row unique
 * @returns {number} - Its id
 */
function user(subject: string): number {
  const result = getDb()
    .prepare("INSERT INTO users (issuer, subject) VALUES ('local', ?)")
    .run(subject)

  return Number(result.lastInsertRowid)
}

/**
 * Reads the ids the sessions table actually holds for a user.
 * @param {number} userId - Account whose rows to read
 * @returns {ReadonlyArray<string>} - Stored id values
 */
function storedIds(userId: number): ReadonlyArray<string> {
  const rows = getDb().prepare('SELECT id FROM sessions WHERE user_id = ?').all(userId) as {
    id: string
  }[]

  return rows.map((row) => row.id)
}

test('the token handed to the browser is not what the table stores', () => {
  const id = user('session-not-stored-raw')
  const token = createSession(id, [])

  const stored = storedIds(id)
  assert.equal(stored.length, 1)
  assert.notEqual(stored[0], token)
  // a row read out of the file is not a bearer: presenting it resolves to nothing
  assert.equal(readSession(stored[0]!), undefined)
})

test('a session resolves back to the account it was opened for', () => {
  const id = user('session-round-trip')
  const token = createSession(id, ['team'])

  const resolved = readSession(token)
  assert.equal(resolved?.id, id)
  assert.equal(resolved?.subject, 'session-round-trip')
  assert.deepEqual(resolved?.groups, ['team'])
})

test('an unknown token resolves to nothing', () => {
  assert.equal(readSession('not-a-session'), undefined)
})

// Handed back to the issuer as `id_token_hint` when this session is signed out, which is what
// makes it end the session there and return the browser rather than stopping on a page of its own.
test('a session hands back the token it was opened with', () => {
  const id = user('session-with-an-id-token')
  const token = createSession(id, [], undefined, false, 'the.id.token')

  assert.equal(readSessionIdToken(token), 'the.id.token')
})

// Every mode but oidc opens sessions without one, and so does an oidc session opened before this
// column existed.
test('a session opened without one hands back nothing', () => {
  const id = user('session-without-an-id-token')
  const token = createSession(id, [])

  assert.equal(readSessionIdToken(token), undefined)
  assert.equal(readSessionIdToken('not-a-session'), undefined)
})

test('ending a session stops its token working', () => {
  const id = user('session-ended')
  const token = createSession(id, [])

  deleteSession(token)

  assert.equal(readSession(token), undefined)
  assert.deepEqual(storedIds(id), [])
})

/**
 * Reads how long a user's session has left, as sqlite itself counts it.
 * @param {number} userId - Account whose single session to read
 * @returns {number} - Seconds until the row expires, rounded
 */
function secondsLeft(userId: number): number {
  const row = getDb()
    .prepare(
      `SELECT (julianday(expires_at) - julianday('now')) * 86400 AS seconds
       FROM sessions WHERE user_id = ?`,
    )
    .get(userId) as { seconds: number }

  return Math.round(row.seconds)
}

/**
 * Moves a user's session through time by shifting its stored timestamps back, which is what the
 * clock running forward would do to the comparison against `now`.
 * @param {number} userId - Account whose sessions to age
 * @param {number} seconds - How far to move them into the past
 * @returns {void}
 */
function age(userId: number, seconds: number): void {
  getDb()
    .prepare(
      `UPDATE sessions
       SET expires_at = datetime(expires_at, @shift), last_seen_at = datetime(last_seen_at, @shift)
       WHERE user_id = @userId`,
    )
    .run({ userId, shift: `-${seconds} seconds` })
}

/**
 * Returns a window from the config in whole seconds, the unit sqlite stores it in.
 * @param {number} ms - Window in milliseconds
 * @returns {number} - The same window in seconds
 */
function seconds(ms: number): number {
  return Math.floor(ms / 1000)
}

// Asserted to the second the clock may tick between the insert and the read.
const SLACK = 2

test('a session opened without remember lasts the default window and no longer', () => {
  const id = user('session-default-window')
  const token = createSession(id, [])
  const window = seconds(config.session.maxAgeMs)

  assert.ok(Math.abs(secondsLeft(id) - window) <= SLACK, `${secondsLeft(id)} of ${window}`)

  age(id, window - 60)
  assert.equal(readSession(token)?.id, id, 'expired before its window was up')

  age(id, 61)
  assert.equal(readSession(token), undefined)
})

test('a remembered session lasts the long window and no longer', () => {
  const id = user('session-remembered-window')
  const token = createSession(id, [], undefined, true)
  const window = seconds(config.session.rememberMaxAgeMs)

  assert.ok(Math.abs(secondsLeft(id) - window) <= SLACK, `${secondsLeft(id)} of ${window}`)

  // Past the default window, which is the one a remembered session must not fall back to.
  age(id, seconds(config.session.maxAgeMs) + 60)
  assert.equal(readSession(token)?.id, id, 'cut short to the default window')

  age(id, secondsLeft(id) + 1)
  assert.equal(readSession(token), undefined)
})

test('a touch past the throttle rolls the window forward from now', () => {
  const id = user('session-rolled')
  const token = createSession(id, [])
  const window = seconds(config.session.maxAgeMs)

  age(id, window - 600)
  touchSession(token)

  assert.ok(Math.abs(secondsLeft(id) - window) <= SLACK, `${secondsLeft(id)} of ${window}`)
})

// Rolled by its own window, or the first request after the throttle would cut it to a day.
test('a touch rolls a remembered session by the long window', () => {
  const id = user('session-remembered-rolled')
  const token = createSession(id, [], undefined, true)
  const window = seconds(config.session.rememberMaxAgeMs)

  age(id, 2 * 60 * 60)
  touchSession(token)

  assert.ok(Math.abs(secondsLeft(id) - window) <= SLACK, `${secondsLeft(id)} of ${window}`)
})

test('a touch inside the throttle leaves the window where it was', () => {
  const id = user('session-throttled')
  const token = createSession(id, [])

  age(id, 30 * 60)
  const before = secondsLeft(id)
  touchSession(token)

  assert.equal(secondsLeft(id), before)
})

test('touching a session keeps it readable', () => {
  const id = user('session-touched')
  const token = createSession(id, [])

  touchSession(token)

  assert.equal(readSession(token)?.id, id)
})

test('sparing one session drops the rest, for a caller that stays signed in', () => {
  const id = user('session-superseded')
  const first = createSession(id, [])
  const second = createSession(id, [])

  deleteUserSessions(id, second)

  assert.equal(readSession(first), undefined)
  assert.equal(readSession(second)?.id, id)
})

test('sparing nothing drops every session the account has', () => {
  const id = user('session-all-dropped')
  const token = createSession(id, [])

  deleteUserSessions(id)

  assert.equal(readSession(token), undefined)
  assert.deepEqual(storedIds(id), [])
})
