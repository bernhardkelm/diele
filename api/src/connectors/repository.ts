import { getDb } from '#db/index.js'
import { deleteRow, nextPosition, reorderRows, setRowEnabled } from '#db/orderedRows.js'
import { notFound } from '#errors.js'
import { listSecretKeys } from '#secrets/repository.js'
import { moduleFor } from './registry.js'

/** What a route may learn about a credential: that it is set, and when it was written. */
export interface SecretField {
  readonly set: boolean
  readonly updatedAt: string | null
}

export interface ConnectorRecord {
  readonly id: number
  readonly type: string
  readonly label: string
  readonly config: Readonly<Record<string, unknown>>
  readonly syncIntervalSeconds: number
  readonly position: number
  readonly enabled: boolean
  /** One entry per credential the module declares, never carrying a value */
  readonly secrets: Readonly<Record<string, SecretField>>
  readonly sync: ConnectorSyncStatus
}

export interface ConnectorSyncStatus {
  readonly lastRunAt: string | null
  readonly lastOkAt: string | null
  readonly lastError: string | null
  readonly entryCount: number
  readonly failures: number
  readonly running: boolean
}

interface ConnectorRow {
  id: number
  type: string
  label: string
  config: string
  sync_interval_s: number
  position: number
  enabled: number
  last_run_at: string | null
  last_ok_at: string | null
  last_error: string | null
  entry_count: number | null
  failures: number | null
  running_since: string | null
}

const SELECT = `
  SELECT c.id, c.type, c.label, c.config, c.sync_interval_s, c.position, c.enabled,
         s.last_run_at, s.last_ok_at, s.last_error, s.entry_count, s.failures, s.running_since
  FROM connectors c
  LEFT JOIN connector_sync s ON s.connector_id = c.id
`

/**
 * Lists the connectors of one type, or every connector when given none.
 * @param {string | undefined} type - Type to filter by
 * @returns {ReadonlyArray<ConnectorRecord>} - Connectors, ordered by position
 */
export function listConnectors(type?: string): ReadonlyArray<ConnectorRecord> {
  const where = type ? 'WHERE c.type = ?' : ''
  const rows = getDb()
    .prepare(`${SELECT} ${where} ORDER BY c.position, c.id`)
    .all(...(type ? [type] : [])) as ConnectorRow[]

  return rows.map(toRecord)
}

/**
 * Lists the connectors that are on and whose module is registered in this build, which is
 * what the scheduler and the entries endpoint work from.
 * @param {string | undefined} type - Type to filter by
 * @returns {ReadonlyArray<ConnectorRecord>} - Enabled connectors, ordered by position
 */
export function listEnabledConnectors(type?: string): ReadonlyArray<ConnectorRecord> {
  return listConnectors(type).filter(
    (entry) => entry.enabled && moduleFor(entry.type) !== undefined,
  )
}

/**
 * Reads one connector.
 * @param {number} id - Connector to read
 * @returns {ConnectorRecord} - The stored connector
 */
export function readConnector(id: number): ConnectorRecord {
  const row = getDb().prepare(`${SELECT} WHERE c.id = ?`).get(id) as ConnectorRow | undefined
  if (!row) {
    throw notFound('connector not found')
  }

  return toRecord(row)
}

export interface StoreConnectorInput {
  readonly type: string
  readonly label: string
  readonly config: Record<string, unknown>
  readonly syncIntervalSeconds: number
}

/**
 * Appends a connector after the last one of its type, and opens its sync row so the scheduler
 * picks it up on the next tick rather than waiting for a first manual run.
 * @param {StoreConnectorInput} input - Validated connector to store
 * @returns {ConnectorRecord} - The stored connector, with its assigned id and position
 */
export function createConnector(input: StoreConnectorInput): ConnectorRecord {
  const db = getDb()

  const id = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO connectors (type, label, config, sync_interval_s, position)
         VALUES (@type, @label, @config, @interval, @position)`,
      )
      .run({
        type: input.type,
        label: input.label,
        config: JSON.stringify(input.config),
        interval: input.syncIntervalSeconds,
        position: nextPosition('connectors', { column: 'type', value: input.type }),
      })

    const created = Number(result.lastInsertRowid)
    db.prepare('INSERT INTO connector_sync (connector_id) VALUES (?)').run(created)

    return created
  })()

  return readConnector(id)
}

export interface PatchConnectorInput {
  readonly label?: string
  readonly config?: Record<string, unknown>
  readonly syncIntervalSeconds?: number
}

/**
 * Applies a partial update to one connector. A changed config makes the next sync due at
 * once, since the point of editing one is usually to find out whether it works.
 * @param {number} id - Connector to update
 * @param {PatchConnectorInput} input - Fields to change; absent ones are left alone
 * @returns {ConnectorRecord} - The updated connector
 */
export function updateConnector(id: number, input: PatchConnectorInput): ConnectorRecord {
  const assignments: string[] = []
  const params: Record<string, unknown> = { id }

  if (input.label !== undefined) {
    assignments.push('label = @label')
    params.label = input.label
  }
  if (input.config !== undefined) {
    assignments.push('config = @config')
    params.config = JSON.stringify(input.config)
  }
  if (input.syncIntervalSeconds !== undefined) {
    assignments.push('sync_interval_s = @interval')
    params.interval = input.syncIntervalSeconds
  }

  if (assignments.length > 0) {
    const result = getDb()
      .prepare(
        `UPDATE connectors SET ${assignments.join(', ')}, updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run(params)

    if (result.changes === 0) {
      throw notFound('connector not found')
    }
  }

  return readConnector(id)
}

/**
 * Turns a connector on or off without deleting it or its entries.
 * @param {number} id - Connector to toggle
 * @param {boolean} enabled - Whether it should sync and be served
 * @returns {void}
 */
export function setConnectorEnabled(id: number, enabled: boolean): void {
  setRowEnabled('connectors', id, enabled, 'connector not found')
}

/**
 * Records that a decorator was read, so the panel can say whether one is working.
 *
 * A decorator runs no sync, so nothing else ever writes these columns for it and a row would
 * otherwise read `never synced` for as long as it existed. Only the three columns that mean
 * "was this reached, and when": entry counts belong to a connector that produces entries, and
 * the backoff to one the scheduler drives.
 * @param {number} connectorId - Connector that was asked
 * @param {string | null} error - What went wrong, already redacted, or null when it answered
 * @returns {void}
 */
export function recordHealthRead(connectorId: number, error: string | null): void {
  getDb()
    .prepare(
      `UPDATE connector_sync
       SET last_run_at = datetime('now'),
           last_ok_at = CASE WHEN @error IS NULL THEN datetime('now') ELSE last_ok_at END,
           last_error = @error
       WHERE connector_id = @connectorId`,
    )
    .run({ connectorId, error })
}

/**
 * Removes a connector. Its credentials, entries and sync state go with it through the foreign
 * keys, so nothing is left holding a token for something that no longer exists.
 * @param {number} id - Connector to delete
 * @returns {void}
 */
export function deleteConnector(id: number): void {
  deleteRow('connectors', id, 'connector not found')
}

/**
 * Rewrites the positions of one type to the given order, in one transaction so a failure
 * cannot leave half the list renumbered.
 * @param {string} type - Type being reordered
 * @param {ReadonlyArray<number>} ids - Ids in their new order
 * @returns {void}
 */
export function reorderConnectors(type: string, ids: ReadonlyArray<number>): void {
  reorderRows('connectors', ids, { column: 'type', value: type })
}

/**
 * Maps a stored row onto the shape the API serves, parsing the config column and replacing
 * every credential with whether it is set.
 * @param {ConnectorRow} row - Row as sqlite returned it
 * @returns {ConnectorRecord} - Connector without any credential value
 */
function toRecord(row: ConnectorRow): ConnectorRecord {
  const declared = moduleFor(row.type)?.secretKeys ?? []
  const stored = new Map(listSecretKeys(row.id).map((entry) => [entry.key, entry.updatedAt]))

  const secrets: Record<string, SecretField> = {}
  for (const key of declared) {
    const updatedAt = stored.get(key)
    secrets[key] = { set: updatedAt !== undefined, updatedAt: updatedAt ?? null }
  }

  return {
    id: row.id,
    type: row.type,
    label: row.label,
    config: parseConfig(row.config),
    syncIntervalSeconds: row.sync_interval_s,
    position: row.position,
    enabled: row.enabled === 1,
    secrets,
    sync: {
      lastRunAt: row.last_run_at,
      lastOkAt: row.last_ok_at,
      lastError: row.last_error,
      entryCount: row.entry_count ?? 0,
      failures: row.failures ?? 0,
      running: row.running_since !== null,
    },
  }
}

/**
 * Reads the config column, tolerating anything that is not a JSON object.
 * @param {string} raw - JSON text from the row
 * @returns {Record<string, unknown>} - Config, empty when unreadable
 */
function parseConfig(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown

    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}
