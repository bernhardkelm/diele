import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readHidden, setHidden } from '#connectors/hidden.js'
import { getDb } from '#db/index.js'

/**
 * Creates an account to hide things as.
 * @param {string} subject - Username, which is what makes the row unique
 * @returns {number} - Its id
 */
function user(subject: string): number {
  const result = getDb()
    .prepare("INSERT INTO users (issuer, subject) VALUES ('local', ?)")
    .run(subject)

  return Number(result.lastInsertRowid)
}

test('hiding for yourself leaves everyone else alone', () => {
  const mine = user('hides-own')
  const other = user('sees-everything')

  setHidden('gitlab:1:repo:1', 'mine', mine, true)

  assert.deepEqual(readHidden(mine), { all: [], mine: ['gitlab:1:repo:1'] })
  assert.deepEqual(readHidden(other), { all: [], mine: [] })
})

test('hiding for everyone reaches an account that hid nothing', () => {
  const admin = user('hides-for-all')
  const other = user('sees-the-portal')

  setHidden('gitlab:1:repo:2', 'all', admin, true)

  assert.deepEqual(readHidden(other).all, ['gitlab:1:repo:2'])
  assert.deepEqual(readHidden(other).mine, [])
})

// The two are separate rows for the same ref, so one being lifted must not lift the other.
test('the two scopes are independent for the same entry', () => {
  const person = user('hides-both-ways')

  setHidden('gitlab:1:repo:3', 'all', person, true)
  setHidden('gitlab:1:repo:3', 'mine', person, true)
  setHidden('gitlab:1:repo:3', 'mine', person, false)

  const hidden = readHidden(person)
  assert.ok(hidden.all.includes('gitlab:1:repo:3'))
  assert.ok(!hidden.mine.includes('gitlab:1:repo:3'))
})

test('hiding something twice is not an error and does not duplicate it', () => {
  const person = user('presses-twice')

  setHidden('gitlab:1:repo:4', 'mine', person, true)
  setHidden('gitlab:1:repo:4', 'mine', person, true)

  assert.deepEqual(readHidden(person).mine, ['gitlab:1:repo:4'])
})

test('bringing back something that was never hidden does nothing', () => {
  const person = user('presses-anyway')

  setHidden('gitlab:1:repo:5', 'mine', person, false)

  assert.deepEqual(readHidden(person).mine, [])
})

test("deleting an account takes its own hidden entries, not the portal's", () => {
  const person = user('leaves')

  setHidden('gitlab:1:repo:6', 'mine', person, true)
  setHidden('gitlab:1:repo:7', 'all', person, true)

  getDb().prepare('DELETE FROM users WHERE id = ?').run(person)

  const remaining = getDb()
    .prepare('SELECT ref FROM hidden_entries WHERE ref IN (?, ?)')
    .all('gitlab:1:repo:6', 'gitlab:1:repo:7') as Array<{ ref: string }>

  assert.deepEqual(
    remaining.map((row) => row.ref),
    ['gitlab:1:repo:7'],
  )
})
