import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { migrate, type Migration } from '#db/migrate.js'

/**
 * Builds a migration that records having run.
 * @param {number} id - Its place in the order
 * @param {string[]} ran - Collects the names of the migrations that applied
 * @returns {Migration} - The migration
 */
function step(id: number, ran: string[]): Migration {
  return {
    id,
    name: `step-${id}`,
    up: (db) => {
      db.exec(`CREATE TABLE step_${id} (id INTEGER PRIMARY KEY)`)
      ran.push(`step-${id}`)
    },
  }
}

/**
 * Opens an empty in-memory database.
 * @returns {Database.Database} - The database
 */
function memory(): Database.Database {
  return new Database(':memory:')
}

test('a fresh database runs every migration in order and records the version', () => {
  const db = memory()
  const ran: string[] = []

  assert.equal(migrate(db, [step(1, ran), step(2, ran)]), 2)
  assert.deepEqual(ran, ['step-1', 'step-2'])
})

test('a database already at the latest version runs nothing', () => {
  const db = memory()
  const ran: string[] = []
  migrate(db, [step(1, ran), step(2, ran)])

  const again: string[] = []
  assert.equal(migrate(db, [step(1, again), step(2, again)]), 2)
  assert.deepEqual(again, [])
})

test('only the migrations past the stored version run', () => {
  const db = memory()
  migrate(db, [step(1, [])])

  const ran: string[] = []
  assert.equal(migrate(db, [step(1, ran), step(2, ran)]), 2)
  assert.deepEqual(ran, ['step-2'])
})

test('ids that are not sequential from 1 are refused before anything runs', () => {
  const db = memory()
  const ran: string[] = []

  assert.throws(() => migrate(db, [step(1, ran), step(3, ran)]), /sequential/)
  assert.deepEqual(ran, [])
})

// Every migration reads as already applied, so without the check the process boots and runs
// ordinary queries against a schema it has no model of. The failure then surfaces as unrelated
// SQL errors rather than as the downgrade it is.
test('a database newer than this build refuses to open rather than running against it', () => {
  const db = memory()
  migrate(db, [step(1, []), step(2, [])])

  assert.throws(() => migrate(db, [step(1, [])]), /newer than this build/)
})

test('the refusal names both versions, so the fix is obvious', () => {
  const db = memory()
  migrate(db, [step(1, []), step(2, [])])

  assert.throws(() => migrate(db, [step(1, [])]), /version 2, which is newer than this build knows \(1\)/)
})
