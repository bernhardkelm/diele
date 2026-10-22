import type { HistorySource } from '@diele/common'
import { parseStringArray } from '#db/json.js'
import type { DB } from '#db/index.js'
import { getHistoryDb } from './db.js'
import { withFreshId } from './entryIds.js'
import { originOf } from './normalise.js'
import { cleanTitle, titleHash } from './titles.js'

/**
 * How many different titles one stripped url may arrive with before it counts as a shell: a page
 * like `/watch` whose content lives in the query string that was stripped. Two is a page that was
 * renamed; three is a pattern.
 */
export const SHELL_TITLES = 3

/**
 * How close a visit from one source has to fall to one from the other for both to be the same
 * page load: the portal reports a Go to as it opens the page, the extension once it has loaded.
 */
export const PAIR_WINDOW_MS = 60_000

export interface Visit {
  /** Url in stored form, already filtered */
  readonly url: string
  readonly title?: string | undefined
  /** ISO 8601 */
  readonly at: string
}

interface EntryRow {
  id: number
  url: string
  title_hashes: string
  visit_count: number
  first_visited_at: string
  last_visited_at: string
  last_source: string | null
}

interface Upsert {
  readonly url: string
  readonly title?: string | undefined
  /** How many visits it stands for, more than one when folding */
  readonly count: number
  readonly firstAt: string
  readonly lastAt: string
  /** Source of the visit counted, null when visits are only moved */
  readonly source: HistorySource | null
}

const COLUMNS = 'id, url, title_hashes, visit_count, first_visited_at, last_visited_at, last_source'

/**
 * Adds visits to an entry, creating it on the first one under a random id.
 * @param {DB} db - Open history database
 * @param {string} owner - The account's history key
 * @param {Upsert} input - What to add
 * @returns {EntryRow} - The entry as it stands afterwards
 */
function upsert(db: DB, owner: string, input: Upsert): EntryRow {
  const statement = db.prepare(
    `INSERT INTO history_entries
       (id, owner, url, title, visit_count, first_visited_at, last_visited_at, last_source)
     VALUES (@id, @owner, @url, @title, @count, @firstAt, @lastAt, @source)
     ON CONFLICT (owner, url) DO UPDATE SET
       title            = COALESCE(excluded.title, title),
       visit_count      = visit_count + excluded.visit_count,
       first_visited_at = MIN(first_visited_at, excluded.first_visited_at),
       last_visited_at  = MAX(last_visited_at, excluded.last_visited_at),
       last_source      = COALESCE(excluded.last_source, last_source)
     RETURNING ${COLUMNS}`,
  )

  return withFreshId(
    (id) => statement.get({ id, owner, ...input, title: input.title ?? null }) as EntryRow,
  )
}

/**
 * Finds the entry a visit is the other half of: the same url, last counted from the other source
 * within the pairing window and not paired since. With both sources on, a Go to is reported by
 * the portal and again by the extension, and counting both would double every such visit.
 * @param {DB} db - Open history database
 * @param {string} owner - The account's history key
 * @param {string} url - Url the visit lands on
 * @param {HistorySource} source - Where the visit came from
 * @param {string} at - When it happened, ISO 8601
 * @returns {EntryRow | undefined} - The entry to pair with, or undefined when the visit counts
 */
function pairFor(
  db: DB,
  owner: string,
  url: string,
  source: HistorySource,
  at: string,
): EntryRow | undefined {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM history_entries WHERE owner = ? AND url = ?`)
    .get(owner, url) as EntryRow | undefined

  if (!row || row.last_source === null || row.last_source === source) {
    return undefined
  }

  return Math.abs(Date.parse(at) - Date.parse(row.last_visited_at)) <= PAIR_WINDOW_MS
    ? row
    : undefined
}

/**
 * Counts one visit to a url, or pairs it with the other source's report of the same load: then
 * the count stays, a title it brings is still taken, and the entry is marked paired so a third
 * report counts again.
 * @param {DB} db - Open history database
 * @param {string} owner - The account's history key
 * @param {Upsert} input - The visit, a count of one
 * @returns {EntryRow} - The entry as it stands afterwards
 */
function addVisit(db: DB, owner: string, input: Upsert): EntryRow {
  const pair = input.source ? pairFor(db, owner, input.url, input.source, input.lastAt) : undefined
  if (!pair) {
    return upsert(db, owner, input)
  }

  return db
    .prepare(
      `UPDATE history_entries SET
         title           = COALESCE(?, title),
         last_visited_at = MAX(last_visited_at, ?),
         last_source     = NULL
       WHERE id = ?
       RETURNING ${COLUMNS}`,
    )
    .get(input.title ?? null, input.lastAt, pair.id) as EntryRow
}

/**
 * Moves a shell page's visits onto its origin and remembers the url as a shell, so later visits
 * land on the origin directly. The origin keeps its own title: the shell's titles belong to
 * whatever its query string pointed at.
 * @param {DB} db - Open history database
 * @param {string} owner - The account's history key
 * @param {EntryRow} row - The shell entry, as it stands
 * @returns {void}
 */
function fold(db: DB, owner: string, row: EntryRow): void {
  upsert(db, owner, {
    url: originOf(row.url),
    count: row.visit_count,
    firstAt: row.first_visited_at,
    lastAt: row.last_visited_at,
    source: null,
  })

  db.prepare('DELETE FROM history_entries WHERE id = ?').run(row.id)
  db.prepare('INSERT OR IGNORE INTO history_shells (owner, url) VALUES (?, ?)').run(owner, row.url)
}

/**
 * Notes a title against an entry, folding the entry into its origin once it has arrived with as
 * many distinct titles as make it a shell. An origin has nothing left to fold into.
 * @param {DB} db - Open history database
 * @param {string} owner - The account's history key
 * @param {EntryRow} row - The entry, as it stands after the visit
 * @param {string} title - The visit's title, already cleaned
 * @returns {void}
 */
function countTitle(db: DB, owner: string, row: EntryRow, title: string): void {
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
 * Records one visit. A url already known as a shell counts towards its origin instead, and one
 * that has just reached its third distinct title becomes a shell. The caps are the caller's to
 * hold, once for the batch.
 * @param {string} owner - The account's history key
 * @param {Visit} visit - What to record
 * @param {HistorySource} source - Where it came from
 * @returns {void}
 */
export function recordVisit(owner: string, visit: Visit, source: HistorySource): void {
  const db = getHistoryDb()
  const title = cleanTitle(visit.title)

  db.transaction(() => {
    const shell = db
      .prepare('SELECT 1 FROM history_shells WHERE owner = ? AND url = ?')
      .get(owner, visit.url)
    const at = { count: 1, firstAt: visit.at, lastAt: visit.at, source }

    if (shell) {
      addVisit(db, owner, { url: originOf(visit.url), ...at })
      return
    }

    const row = addVisit(db, owner, { url: visit.url, title, ...at })

    if (title) {
      countTitle(db, owner, row, title)
    }
  })()
}
