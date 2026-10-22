import { config } from '#config.js'
import type { DB } from '#db/index.js'
import { listHistoryKeys } from '#users/historyKey.js'
import { peekHistoryDb } from './db.js'
import { shellCap } from './record.js'
import { isAvailable } from './state.js'

const DAY_MS = 24 * 60 * 60_000

/**
 * Deletes the rows filed under a key no account holds any more. Nothing cascades across the two
 * files, so this is what deleting an account, or restoring the configuration from before it
 * existed, relies on.
 * @param {DB} db - Open history database
 * @returns {void}
 */
function sweepOrphans(db: DB): void {
  const owners = JSON.stringify(listHistoryKeys())

  for (const table of ['history_entries', 'history_shells', 'history_preferences']) {
    db.prepare(`DELETE FROM ${table} WHERE owner NOT IN (SELECT value FROM json_each(?))`).run(
      owners,
    )
  }
}

/**
 * Applies the retention rules to what accounts kept: a page visited once expires after the
 * one-off window, and an account keeps at most its cap of entries, the least recently visited
 * going first, and its cap of shells, the oldest going first.
 * @param {DB} db - Open history database
 * @param {number} now - Current time, in ms since the epoch
 * @returns {void}
 */
function applyRetention(db: DB, now: number): void {
  const cutoff = new Date(now - config.history.oneOffDays * DAY_MS).toISOString()

  db.prepare('DELETE FROM history_entries WHERE visit_count = 1 AND last_visited_at < ?').run(
    cutoff,
  )

  db.prepare(
    `DELETE FROM history_entries WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (
           PARTITION BY owner ORDER BY last_visited_at DESC, id DESC
         ) AS rank
         FROM history_entries
       ) WHERE rank > ?
     )`,
  ).run(config.history.maxEntries)

  db.prepare(
    `DELETE FROM history_shells WHERE rowid IN (
       SELECT shell FROM (
         SELECT rowid AS shell, ROW_NUMBER() OVER (PARTITION BY owner ORDER BY rowid DESC) AS rank
         FROM history_shells
       ) WHERE rank > ?
     )`,
  ).run(shellCap())
}

/**
 * Prunes the history file, when there is one. The orphan sweep always runs, since those rows are
 * no account's any more. The retention rules wait while the feature is off: switching it off
 * stops recording and serving and nothing else, and expiring what was kept in the meantime would
 * make it a delete after all.
 * @param {number} now - Current time, in ms since the epoch
 * @returns {void}
 */
export function pruneHistory(now: number = Date.now()): void {
  const db = peekHistoryDb()
  if (!db) {
    return
  }

  db.transaction(() => {
    sweepOrphans(db)

    if (isAvailable()) {
      applyRetention(db, now)
    }
  })()
}
