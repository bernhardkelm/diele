import { config } from '#config.js'
import type { DB } from '#db/index.js'

/**
 * How many folded shell urls an account keeps, a fifth of its entries. A shell is a marker, not a
 * page anyone is offered, so it needs far fewer, and without a cap of its own minting them would
 * grow the file past every entry cap there is.
 * @returns {number} - Shells kept per account
 */
export function shellCap(): number {
  return Math.max(1, Math.ceil(config.history.maxEntries / 5))
}

/**
 * Holds an account to its caps, the least recently visited entries and the oldest shells going
 * first. Run once for every batch written, so a flood of visits cannot grow the file between two
 * prunes.
 * @param {DB} db - Open history database
 * @param {string} owner - The account's history key
 * @returns {void}
 */
export function enforceCaps(db: DB, owner: string): void {
  db.prepare(
    `DELETE FROM history_entries WHERE id IN (
       SELECT id FROM history_entries WHERE owner = ?
       ORDER BY last_visited_at DESC, id DESC
       LIMIT -1 OFFSET ?
     )`,
  ).run(owner, config.history.maxEntries)

  db.prepare(
    `DELETE FROM history_shells WHERE rowid IN (
       SELECT rowid FROM history_shells WHERE owner = ?
       ORDER BY rowid DESC
       LIMIT -1 OFFSET ?
     )`,
  ).run(owner, shellCap())
}
