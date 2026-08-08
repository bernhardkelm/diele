import { getDb } from '#db/index.js'
import { parseJsonArray, parseStringArray } from '#db/json.js'
import { isHttpUrl } from '#fieldSchemas.js'
import { entryRef } from './refs.js'
import type { EntryAction } from '@diele/common'
import type { ProducedEntry } from './types.js'

export interface EntryRecord {
  readonly connectorId: number
  readonly connectorType: string
  readonly ref: string
  readonly kind: string
  readonly label: string
  readonly detail: string | null
  readonly url: string
  readonly keywords: ReadonlyArray<string>
  readonly actions: ReadonlyArray<EntryAction>
  readonly timestamp: string | null
  readonly parentRef: string | null
  readonly searchOnly: boolean
  readonly healthRef: string | null
}

interface EntryRow {
  connector_id: number
  type: string
  ref: string
  kind: string
  label: string
  detail: string | null
  url: string
  keywords: string
  actions: string
  timestamp: string | null
  parent_ref: string | null
  search_only: number
  health_ref: string | null
}

export interface ReplaceOptions {
  /**
   * Set when the run only reached part of its source. Rows it did not touch are then left
   * standing rather than swept, so one unreachable group cannot empty a whole section.
   */
  readonly partial?: boolean
}

/**
 * Drops the actions whose href a browser should not be handed. A connector's output is a remote
 * source's word, not an operator's, and every href here is rendered as a link on the portal.
 * @param {ReadonlyArray<EntryAction> | undefined} actions - Actions the run produced
 * @returns {ReadonlyArray<EntryAction>} - The ones safe to store
 */
function safeActions(actions: ReadonlyArray<EntryAction> | undefined): ReadonlyArray<EntryAction> {
  return (actions ?? []).filter((action) => action.href === undefined || isHttpUrl(action.href))
}

/**
 * Writes a run's entries and removes what the run no longer produced.
 *
 * A complete run clears the connector's rows and writes what it found, both inside one
 * transaction so no reader ever sees it half-empty. A partial run only upserts, which is what
 * keeps one unreachable group from emptying a whole section.
 *
 * Deliberately not a timestamp comparison: two runs landing in the same millisecond share a
 * stamp, and the second would then sweep nothing at all.
 * @param {number} connectorId - Connector the entries belong to
 * @param {string} type - Connector type, which qualifies every ref
 * @param {ReadonlyArray<ProducedEntry>} entries - What the run collected
 * @param {ReplaceOptions} options - Whether the run was complete
 * @returns {number} - How many entries the connector holds afterwards
 */
export function replaceEntries(
  connectorId: number,
  type: string,
  entries: ReadonlyArray<ProducedEntry>,
  options: ReplaceOptions = {},
): number {
  const db = getDb()

  const upsert = db.prepare(
    `INSERT INTO connector_entries
       (connector_id, ref, kind, label, detail, url, keywords, actions, sort_key, timestamp,
        parent_ref, search_only, health_ref, synced_at)
     VALUES
       (@connectorId, @ref, @kind, @label, @detail, @url, @keywords, @actions, @sortKey,
        @timestamp, @parentRef, @searchOnly, @healthRef, datetime('now'))
     ON CONFLICT (connector_id, ref) DO UPDATE SET
       kind = excluded.kind, label = excluded.label, detail = excluded.detail,
       url = excluded.url, keywords = excluded.keywords, actions = excluded.actions,
       sort_key = excluded.sort_key, timestamp = excluded.timestamp,
       parent_ref = excluded.parent_ref, search_only = excluded.search_only,
       health_ref = excluded.health_ref, synced_at = datetime('now')`,
  )

  return db.transaction(() => {
    if (!options.partial) {
      db.prepare('DELETE FROM connector_entries WHERE connector_id = ?').run(connectorId)
    }

    for (const entry of entries) {
      if (!isHttpUrl(entry.url)) {
        console.warn(`[connectors] dropped ${entry.localRef}: url is not http(s)`)
        continue
      }

      upsert.run({
        connectorId,
        ref: entryRef(type, connectorId, entry.localRef),
        kind: entry.kind,
        label: entry.label,
        detail: entry.detail ?? null,
        url: entry.url,
        keywords: JSON.stringify(entry.keywords ?? []),
        actions: JSON.stringify(safeActions(entry.actions)),
        sortKey: entry.sortKey ?? entry.label,
        timestamp: entry.timestamp ?? null,
        parentRef: entry.parentLocalRef ? entryRef(type, connectorId, entry.parentLocalRef) : null,
        searchOnly: entry.searchOnly ? 1 : 0,
        healthRef: entry.healthRef ?? null,
      })
    }

    const count = db
      .prepare('SELECT COUNT(*) AS count FROM connector_entries WHERE connector_id = ?')
      .get(connectorId) as { count: number }

    return count.count
  })()
}

/**
 * Lists the entries of every enabled connector, in the order they should render.
 * @returns {ReadonlyArray<EntryRecord>} - Entries, grouped by connector and sorted within each
 */
export function listEntries(): ReadonlyArray<EntryRecord> {
  const rows = getDb()
    .prepare(
      `SELECT e.connector_id, c.type, e.ref, e.kind, e.label, e.detail, e.url, e.keywords,
              e.actions, e.timestamp, e.parent_ref, e.search_only, e.health_ref
       FROM connector_entries e
       JOIN connectors c ON c.id = e.connector_id
       WHERE c.enabled = 1
       ORDER BY c.position, c.id, e.sort_key, e.ref`,
    )
    .all() as EntryRow[]

  return rows.map(toRecord)
}

/**
 * Maps a stored row onto the shape the API serves, parsing the JSON columns.
 * @param {EntryRow} row - Row as sqlite returned it
 * @returns {EntryRecord} - Entry with its keywords and actions parsed
 */
function toRecord(row: EntryRow): EntryRecord {
  return {
    connectorId: row.connector_id,
    connectorType: row.type,
    ref: row.ref,
    kind: row.kind,
    label: row.label,
    detail: row.detail,
    url: row.url,
    keywords: parseStringArray(row.keywords),
    actions: parseJsonArray<EntryAction>(
      row.actions,
      (entry) => entry !== null && typeof entry === 'object' && 'href' in entry,
    ),
    timestamp: row.timestamp,
    parentRef: row.parent_ref,
    searchOnly: row.search_only === 1,
    healthRef: row.health_ref,
  }
}
