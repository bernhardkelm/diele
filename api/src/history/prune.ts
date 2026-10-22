import { config } from '#config.js'
import type { DB } from '#db/index.js'
import { listHistoryKeys } from '#users/historyKey.js'
import { shellCap } from './caps.js'
import { checkpointHistory, peekHistoryDb } from './db.js'
import { isAvailable } from './state.js'

const DAY_MS = 24 * 60 * 60_000

const TABLES = ['history_entries', 'history_shells', 'history_preferences'] as const

// Owners whose retention runs: opted in. One that opted out keeps what it has, as it would while
// the instance is off, because switching off never deletes.
const RETAINED = 'owner IN (SELECT owner FROM history_preferences WHERE enabled = 1)'

/** Whether the skipped sweep has been reported, so a restore left as it is logs once. */
let reported = false

/**
 * Returns whether the orphan sweep must not run: the file holds rows, and no account holds a
 * history key at all, or none of the owners in the file is one an account holds. Both are what a main database restored
 * from before history was used, or a wrong `DB_PATH`, looks like, and sweeping then would delete
 * every account's history for good.
 * @param {DB} db - Open history database
 * @param {ReadonlyArray<string>} keys - The keys accounts hold
 * @returns {boolean} - True when the sweep should be skipped
 */
function sweepWouldWipe(db: DB, keys: ReadonlyArray<string>): boolean {
  const owners = db
    .prepare(TABLES.map((table) => `SELECT owner FROM ${table}`).join(' UNION '))
    .pluck()
    .all() as string[]
  const held = new Set(keys)

  return owners.length > 0 && owners.every((owner) => !held.has(owner))
}

/**
 * Deletes the rows filed under a key no account holds any more. Nothing cascades across the two
 * files, so this is what deleting an account, or restoring the configuration from before it
 * existed, relies on. Skipped, with one line in the log that names nobody, when it would remove
 * every owner there is.
 * @param {DB} db - Open history database
 * @returns {number} - How many rows were deleted
 */
function sweepOrphans(db: DB): number {
  const keys = listHistoryKeys()

  if (sweepWouldWipe(db, keys)) {
    if (!reported) {
      console.warn(
        '[history] no account holds a key the history file is filed under; the orphan sweep is ' +
          'skipped until one does, check that DB_PATH and HISTORY_DB_PATH belong together',
      )
      reported = true
    }

    return 0
  }

  reported = false
  const owners = JSON.stringify(keys)

  return TABLES.reduce(
    (removed, table) =>
      removed +
      db
        .prepare(`DELETE FROM ${table} WHERE owner NOT IN (SELECT value FROM json_each(?))`)
        .run(owners).changes,
    0,
  )
}

/**
 * Applies the retention rules to what opted-in accounts kept: a page visited once expires after
 * the one-off window, and an account keeps at most its cap of entries, the least recently visited
 * going first, and its cap of shells, the oldest going first.
 * @param {DB} db - Open history database
 * @param {number} now - Current time, in ms since the epoch
 * @returns {number} - How many rows were deleted
 */
function applyRetention(db: DB, now: number): number {
  const cutoff = new Date(now - config.history.oneOffDays * DAY_MS).toISOString()

  const expired = db
    .prepare(
      `DELETE FROM history_entries
       WHERE visit_count = 1 AND last_visited_at < ? AND ${RETAINED}`,
    )
    .run(cutoff).changes

  const entries = db
    .prepare(
      `DELETE FROM history_entries WHERE id IN (
         SELECT id FROM (
           SELECT id, ROW_NUMBER() OVER (
             PARTITION BY owner ORDER BY last_visited_at DESC, id DESC
           ) AS rank
           FROM history_entries
           WHERE ${RETAINED}
         ) WHERE rank > ?
       )`,
    )
    .run(config.history.maxEntries).changes

  const shells = db
    .prepare(
      `DELETE FROM history_shells WHERE rowid IN (
         SELECT shell FROM (
           SELECT rowid AS shell, ROW_NUMBER() OVER (PARTITION BY owner ORDER BY rowid DESC) AS rank
           FROM history_shells
           WHERE ${RETAINED}
         ) WHERE rank > ?
       )`,
    )
    .run(shellCap()).changes

  return expired + entries + shells
}

/**
 * Prunes the history file, when there is one. The orphan sweep always runs, since those rows are
 * no account's any more. The retention rules wait while the feature is off, and for every account
 * that opted out: switching off stops recording and nothing else, and expiring what was kept in
 * the meantime would make it a delete after all. A prune that removed anything folds the log into
 * the file, so the rows are gone from the `-wal` too.
 * @param {number} now - Current time, in ms since the epoch
 * @returns {void}
 */
export function pruneHistory(now: number = Date.now()): void {
  const db = peekHistoryDb()
  if (!db) {
    return
  }

  const removed = db.transaction(() => {
    const orphans = sweepOrphans(db)

    return isAvailable() ? orphans + applyRetention(db, now) : orphans
  })()

  if (removed > 0) {
    checkpointHistory()
  }
}
