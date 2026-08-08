import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getDb } from '#db/index.js'
import {
  createSession,
  deleteOtherSessions,
  deleteSession,
  readSession,
  touchSession,
} from './session.js'

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

test('ending a session stops its token working', () => {
  const id = user('session-ended')
  const token = createSession(id, [])

  deleteSession(token)

  assert.equal(readSession(token), undefined)
  assert.deepEqual(storedIds(id), [])
})

test('touching a session keeps it readable', () => {
  const id = user('session-touched')
  const token = createSession(id, [])

  touchSession(token)

  assert.equal(readSession(token)?.id, id)
})

test('signing in again drops the other sessions and spares the current one', () => {
  const id = user('session-superseded')
  const first = createSession(id, [])
  const second = createSession(id, [])

  deleteOtherSessions(id, second)

  assert.equal(readSession(first), undefined)
  assert.equal(readSession(second)?.id, id)
})

test('sparing nothing drops every session the account has', () => {
  const id = user('session-all-dropped')
  const token = createSession(id, [])

  deleteOtherSessions(id)

  assert.equal(readSession(token), undefined)
  assert.deepEqual(storedIds(id), [])
})
