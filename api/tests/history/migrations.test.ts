import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { migrate } from '#db/migrate.js'
import { init } from '#history/migrations/001_init.js'
import { randomIds } from '#history/migrations/002_randomIds.js'

// A counter would tell every account how many entries the instance has created.
test('existing entries get random ids and keep everything else', () => {
  const db = new Database(':memory:')
  migrate(db, [init])

  const insert = db.prepare(
    `INSERT INTO history_entries (owner, url, title, visit_count, first_visited_at, last_visited_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  for (let index = 0; index < 5; index += 1) {
    insert.run(
      'owner',
      `https://e${index}.example/`,
      `T${index}`,
      index + 1,
      '2026-01-01',
      '2026-01-02',
    )
  }

  migrate(db, [init, randomIds])

  const rows = db
    .prepare('SELECT id, url, title, visit_count, last_source FROM history_entries ORDER BY url')
    .all() as Array<{
    id: number
    url: string
    title: string
    visit_count: number
    last_source: null
  }>

  assert.equal(rows.length, 5)
  assert.equal(new Set(rows.map((row) => row.id)).size, 5)
  assert.ok(rows.every((row) => Number.isSafeInteger(row.id) && row.id > 5))
  assert.deepEqual(
    rows.map((row) => [row.url, row.title, row.visit_count, row.last_source]),
    [0, 1, 2, 3, 4].map((index) => [`https://e${index}.example/`, `T${index}`, index + 1, null]),
  )

  const sequence = db
    .prepare("SELECT name FROM sqlite_master WHERE name = 'sqlite_sequence'")
    .get() as { name: string } | undefined
  const counted = sequence
    ? db
        .prepare("SELECT COUNT(*) AS count FROM sqlite_sequence WHERE name = 'history_entries'")
        .get()
    : { count: 0 }
  assert.deepEqual(counted, { count: 0 })

  db.close()
})
