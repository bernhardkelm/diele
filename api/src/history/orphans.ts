import type { DB } from '#db/index.js'
import { listHistoryKeys } from '#users/historyKey.js'

const DAY_MS = 24 * 60 * 60_000

/** How long the sweep waits while no owner in the file is held, before taking it as deleted. */
export const ORPHAN_GRACE_MS = 30 * DAY_MS

const TABLES = ['history_entries', 'history_shells', 'history_preferences'] as const

/** The meta row holding when a prune first found every owner unheld, in ms since the epoch. */
const UNHELD_SINCE = 'orphans.unheldSince'

/** Whether the waiting sweep has been reported since this process started, so it logs once. */
let reported = false

/**
 * Returns whether the file holds rows and none of their owners is a key an account holds, which
 * is also the case when no account holds a key at all. That is what a main database restored
 * from before history was used, or a wrong `DB_PATH`, looks like, as well as the deletion of the
 * last account that used history.
 * @param {DB} db - Open history database
 * @param {ReadonlyArray<string>} keys - The keys accounts hold
 * @returns {boolean} - True when a sweep would remove every owner there is
 */
function everyOwnerUnheld(db: DB, keys: ReadonlyArray<string>): boolean {
  const owners = db
    .prepare(TABLES.map((table) => `SELECT owner FROM ${table}`).join(' UNION '))
    .pluck()
    .all() as string[]
  const held = new Set(keys)

  return owners.length > 0 && owners.every((owner) => !held.has(owner))
}

/**
 * Reads since when every owner has been unheld, noting now as that time on the first prune that
 * finds it, so the wait survives restarts.
 * @param {DB} db - Open history database
 * @param {number} now - Current time, in ms since the epoch
 * @returns {number} - The first time it was found, in ms since the epoch
 */
function unheldSince(db: DB, now: number): number {
  db.prepare('INSERT OR IGNORE INTO history_meta (key, value) VALUES (?, ?)').run(
    UNHELD_SINCE,
    String(now),
  )
  const value = db.prepare('SELECT value FROM history_meta WHERE key = ?').pluck().get(UNHELD_SINCE)

  return Number(value)
}

/**
 * Decides whether the sweep may run. While every owner is unheld it waits thirty days from the
 * first prune that found so, with one log line that names nobody, since sweeping a file whose
 * main database was restored or mixed up would delete everyone's history for good. Past that it
 * takes the owners as deleted, says so once more, and lets the sweep run. An owner held again in
 * the meantime resets the wait.
 * @param {DB} db - Open history database
 * @param {ReadonlyArray<string>} keys - The keys accounts hold
 * @param {number} now - Current time, in ms since the epoch
 * @returns {boolean} - True when the sweep may run
 */
function maySweep(db: DB, keys: ReadonlyArray<string>, now: number): boolean {
  if (!everyOwnerUnheld(db, keys)) {
    db.prepare('DELETE FROM history_meta WHERE key = ?').run(UNHELD_SINCE)
    reported = false
    return true
  }

  if (now - unheldSince(db, now) < ORPHAN_GRACE_MS) {
    if (!reported) {
      console.warn(
        '[history] no account holds a key the history file is filed under; the orphan sweep ' +
          'waits 30 days for one to, check that DB_PATH and HISTORY_DB_PATH belong together',
      )
      reported = true
    }

    return false
  }

  console.warn(
    '[history] no account has held a key the history file is filed under for 30 days; ' +
      'sweeping every owner in it',
  )
  db.prepare('DELETE FROM history_meta WHERE key = ?').run(UNHELD_SINCE)
  reported = false
  return true
}

/**
 * Deletes the rows filed under a key no account holds any more. Nothing cascades across the two
 * files, so this is what deleting an account, or restoring the configuration from before it
 * existed, relies on; when it would remove every owner, it waits first.
 * @param {DB} db - Open history database
 * @param {number} now - Current time, in ms since the epoch
 * @returns {number} - How many rows were deleted
 */
export function sweepOrphans(db: DB, now: number): number {
  const keys = listHistoryKeys()

  if (!maySweep(db, keys, now)) {
    return 0
  }

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
