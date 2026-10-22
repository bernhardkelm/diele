import type { ApiHistoryEntry } from '@diele/common'
import { checkpointHistory, getHistoryDb, peekHistoryDb } from './db.js'
import { isOnDomain } from './domains.js'
import { hostnameOf, originOf } from './normalise.js'
import { bumpForgetEpoch } from './preferences.js'

export interface EntryRow {
  id: number
  url: string
  title: string | null
  visit_count: number
  last_visited_at: string
}

/**
 * Lists every entry an account holds, most recently visited first.
 * @param {string | undefined} owner - The account's history key, undefined when it has none
 * @returns {ReadonlyArray<ApiHistoryEntry>} - Entries in wire shape
 */
export function listEntries(owner: string | undefined): ReadonlyArray<ApiHistoryEntry> {
  if (owner === undefined) {
    return []
  }

  const rows = peekHistoryDb()
    ?.prepare(
      `SELECT id, url, title, visit_count, last_visited_at
       FROM history_entries
       WHERE owner = ?
       ORDER BY last_visited_at DESC, id DESC`,
    )
    .all(owner) as EntryRow[] | undefined

  return (rows ?? []).map(toWire)
}

/**
 * Returns whether an account already holds a url, as an entry or as a shell folded into its
 * origin, which is what spares a visit the probe. Asked of this account's rows only: an answer
 * drawn from anyone else's would tell this one where they had been.
 * @param {string} owner - The account's history key
 * @param {string} url - Url in stored form
 * @returns {boolean} - True when the url is already known
 */
export function hasEntry(owner: string, url: string): boolean {
  const row = peekHistoryDb()
    ?.prepare(
      `SELECT 1 FROM history_entries WHERE owner = @owner AND url = @url
       UNION ALL
       SELECT 1 FROM history_shells WHERE owner = @owner AND url = @url`,
    )
    .get({ owner, url })

  return row !== undefined
}

/**
 * Runs a delete the account asked for: moves its forget epoch on so nothing in flight writes the
 * rows back, and folds the log into the file so the rows are gone from disk too.
 * @param {string} owner - The account's history key
 * @param {() => number} remove - The delete, answering how many rows it removed
 * @returns {number} - How many rows were removed
 */
function forget(owner: string, remove: () => number): number {
  const db = getHistoryDb()
  const removed = db.transaction(() => {
    bumpForgetEpoch(owner)
    return remove()
  })()

  checkpointHistory()
  return removed
}

/**
 * Removes one entry, only when it belongs to the account asking. An origin entry takes the shells
 * folded into it along, in the same transaction: they name pages under that origin the account
 * went to, and the origin is the only entry they ever show up as.
 * @param {string | undefined} owner - The account's history key, undefined when it has none
 * @param {number} id - Entry to remove
 * @returns {boolean} - True when something was removed
 */
export function deleteEntry(owner: string | undefined, id: number): boolean {
  const db = peekHistoryDb()
  if (!db || owner === undefined) {
    return false
  }

  const removed = forget(owner, () => {
    const row = db
      .prepare('DELETE FROM history_entries WHERE id = ? AND owner = ? RETURNING url')
      .get(id, owner) as { url: string } | undefined

    if (!row) {
      return 0
    }

    if (originOf(row.url) === row.url) {
      // Every url that starts with the origin and its slash sorts between it and the same string
      // with the slash raised to `0`: exact, case-sensitive, nothing to escape, and on the key.
      db.prepare('DELETE FROM history_shells WHERE owner = ? AND url >= ? AND url < ?').run(
        owner,
        row.url,
        `${row.url.slice(0, -1)}0`,
      )
    }

    return 1
  })

  return removed > 0
}

/**
 * Counts the entries an account holds, whatever the switches say.
 * @param {string | undefined} owner - The account's history key, undefined when it has none
 * @returns {number} - How many entries it keeps
 */
export function countEntries(owner: string | undefined): number {
  if (owner === undefined) {
    return 0
  }

  const row = peekHistoryDb()
    ?.prepare('SELECT COUNT(*) AS count FROM history_entries WHERE owner = ?')
    .get(owner) as { count: number } | undefined

  return row?.count ?? 0
}

/**
 * Removes everything an account has visited, the folded shell pages with it, since those name
 * pages it went to as well. The preferences stay: clearing is not opting out.
 * @param {string | undefined} owner - The account's history key, undefined when it has none
 * @returns {void}
 */
export function clearEntries(owner: string | undefined): void {
  const db = peekHistoryDb()
  if (!db || owner === undefined) {
    return
  }

  forget(owner, () => {
    const entries = db.prepare('DELETE FROM history_entries WHERE owner = ?').run(owner).changes
    const shells = db.prepare('DELETE FROM history_shells WHERE owner = ?').run(owner).changes

    return entries + shells
  })
}

/**
 * Removes what an account holds on a domain and its subdomains. The host is read in code rather
 * than matched in SQL, because a `LIKE` on the url cannot tell `example.com` from `notexample.com`.
 * @param {string} owner - The account's history key
 * @param {ReadonlyArray<string>} domains - Domains in normalised form
 * @returns {void}
 */
export function deleteOnDomains(owner: string, domains: ReadonlyArray<string>): void {
  if (domains.length === 0) {
    return
  }

  const db = getHistoryDb()
  const covered = (url: string): boolean => {
    const hostname = hostnameOf(new URL(url))
    return domains.some((domain) => isOnDomain(hostname, domain))
  }

  forget(owner, () => {
    let removed = 0

    for (const table of ['history_entries', 'history_shells']) {
      const rows = db.prepare(`SELECT url FROM ${table} WHERE owner = ?`).all(owner) as Array<{
        url: string
      }>
      const remove = db.prepare(`DELETE FROM ${table} WHERE owner = ? AND url = ?`)

      for (const row of rows.filter((entry) => covered(entry.url))) {
        removed += remove.run(owner, row.url).changes
      }
    }

    return removed
  })
}

/**
 * Maps a stored row onto the shape the API serves.
 * @param {EntryRow} row - Row as sqlite returned it
 * @returns {ApiHistoryEntry} - Entry in wire shape
 */
export function toWire(row: EntryRow): ApiHistoryEntry {
  return {
    id: row.id,
    url: row.url,
    ...(row.title ? { title: row.title } : {}),
    visits: row.visit_count,
    lastVisitedAt: row.last_visited_at,
  }
}
