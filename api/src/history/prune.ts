import { config } from '#config.js'
import type { DB } from '#db/index.js'
import { shellCap } from './caps.js'
import { checkpointHistory, peekHistoryDb } from './db.js'
import { sweepOrphans } from './orphans.js'
import { isAvailable } from './state.js'

const DAY_MS = 24 * 60 * 60_000

// Owners whose retention runs: opted in. One that opted out keeps what it has, as it would while
// the instance is off, because switching off never deletes.
const RETAINED = 'owner IN (SELECT owner FROM history_preferences WHERE enabled = 1)'

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
 * Prunes the history file, when there is one. The orphan sweep runs whatever the switches say,
 * since those rows are no account's any more, and waits only when it would remove every owner. The retention rules wait while the feature is off, and for every account
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
    const orphans = sweepOrphans(db, now)

    return isAvailable() ? orphans + applyRetention(db, now) : orphans
  })()

  if (removed > 0) {
    checkpointHistory()
  }
}
