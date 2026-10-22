import { config } from '#config.js'
import { parseStringArray } from '#db/json.js'
import type { DB } from '#db/index.js'
import { getHistoryDb } from './db.js'
import { originOf } from './normalise.js'
import { cleanTitle, titleHash } from './titles.js'

/**
 * How many different titles one stripped url may arrive with before it counts as a shell: a page
 * like `/watch` whose content lives in the query string that was stripped. Two is a page that was
 * renamed; three is a pattern.
 */
export const SHELL_TITLES = 3

export interface Visit {
  /** Url in stored form, already filtered */
  readonly url: string
  readonly title?: string | undefined
  /** ISO 8601 */
  readonly at: string
}

interface UpsertedRow {
  id: number
  url: string
  title_hashes: string
  visit_count: number
  first_visited_at: string
  last_visited_at: string
}

interface Upsert {
  readonly url: string
  readonly title?: string | undefined
  /** How many visits it stands for, more than one when folding */
  readonly count: number
  readonly firstAt: string
  readonly lastAt: string
}

/**
 * Adds visits to an entry, creating it on the first one.
 * @param {DB} db - Open history database
 * @param {string} owner - The account's history key
 * @param {Upsert} input - What to add
 * @returns {UpsertedRow} - The entry as it stands afterwards
 */
function upsert(db: DB, owner: string, input: Upsert): UpsertedRow {
  return db
    .prepare(
      `INSERT INTO history_entries
         (owner, url, title, visit_count, first_visited_at, last_visited_at)
       VALUES (@owner, @url, @title, @count, @firstAt, @lastAt)
       ON CONFLICT (owner, url) DO UPDATE SET
         title            = COALESCE(excluded.title, title),
         visit_count      = visit_count + excluded.visit_count,
         first_visited_at = MIN(first_visited_at, excluded.first_visited_at),
         last_visited_at  = MAX(last_visited_at, excluded.last_visited_at)
       RETURNING id, url, title_hashes, visit_count, first_visited_at, last_visited_at`,
    )
    .get({ owner, ...input, title: input.title ?? null }) as UpsertedRow
}

/**
 * Moves a shell page's visits onto its origin and remembers the url as a shell, so later visits
 * land on the origin directly. The origin keeps its own title: the shell's titles belong to
 * whatever its query string pointed at.
 * @param {DB} db - Open history database
 * @param {string} owner - The account's history key
 * @param {UpsertedRow} row - The shell entry, as it stands
 * @returns {void}
 */
function fold(db: DB, owner: string, row: UpsertedRow): void {
  upsert(db, owner, {
    url: originOf(row.url),
    count: row.visit_count,
    firstAt: row.first_visited_at,
    lastAt: row.last_visited_at,
  })

  db.prepare('DELETE FROM history_entries WHERE id = ?').run(row.id)
  db.prepare('INSERT OR IGNORE INTO history_shells (owner, url) VALUES (?, ?)').run(owner, row.url)
}

/**
 * Notes a title against an entry, folding the entry into its origin once it has arrived with as
 * many distinct titles as make it a shell. An origin has nothing left to fold into.
 * @param {DB} db - Open history database
 * @param {string} owner - The account's history key
 * @param {UpsertedRow} row - The entry, as it stands after the visit
 * @param {string} title - The visit's title, already cleaned
 * @returns {void}
 */
function countTitle(db: DB, owner: string, row: UpsertedRow, title: string): void {
  if (originOf(row.url) === row.url) {
    return
  }

  const hashes = parseStringArray(row.title_hashes)
  const hash = titleHash(title)
  if (hashes.includes(hash)) {
    return
  }

  const seen = [...hashes, hash]
  if (seen.length >= SHELL_TITLES) {
    fold(db, owner, row)
    return
  }

  db.prepare('UPDATE history_entries SET title_hashes = ? WHERE id = ?').run(
    JSON.stringify(seen),
    row.id,
  )
}

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
 * first. Run with every insert, so a flood of visits cannot grow the file between two prunes.
 * @param {DB} db - Open history database
 * @param {string} owner - The account's history key
 * @returns {void}
 */
function enforceCaps(db: DB, owner: string): void {
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

/**
 * Records one visit. A url already known as a shell counts towards its origin instead, and one
 * that has just reached its third distinct title becomes a shell.
 * @param {string} owner - The account's history key
 * @param {Visit} visit - What to record
 * @returns {void}
 */
export function recordVisit(owner: string, visit: Visit): void {
  const db = getHistoryDb()
  const title = cleanTitle(visit.title)

  db.transaction(() => {
    const shell = db
      .prepare('SELECT 1 FROM history_shells WHERE owner = ? AND url = ?')
      .get(owner, visit.url)
    const at = { count: 1, firstAt: visit.at, lastAt: visit.at }

    if (shell) {
      upsert(db, owner, { url: originOf(visit.url), ...at })
    } else {
      const row = upsert(db, owner, { url: visit.url, title, ...at })

      if (title) {
        countTitle(db, owner, row, title)
      }
    }

    enforceCaps(db, owner)
  })()
}
