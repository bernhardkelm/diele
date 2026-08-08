import type { ApiLocalhostPort } from '@diele/common'
import { portRef } from '#connectors/refs.js'
import { getDb } from '#db/index.js'
import { deleteRow, nextPosition, reorderRows, setRowEnabled } from '#db/orderedRows.js'
import { parseStringArray } from '#db/json.js'
import { badRequest, isUniqueConstraintError, notFound } from '#errors.js'
import type { CreateLocalhostInput, UpdateLocalhostInput } from './schemas.js'

interface LocalhostRow {
  id: number
  scheme: 'http' | 'https'
  port: number
  keywords: string
  position: number
  enabled: number
}

/**
 * Lists the enabled ports, for the portal to probe and offer.
 * @returns {ReadonlyArray<ApiLocalhostPort>} - Ports, ordered by position
 */
export function listLocalhost(): ReadonlyArray<ApiLocalhostPort> {
  const rows = getDb()
    .prepare(
      'SELECT id, scheme, port, keywords, position, enabled FROM localhost_ports WHERE enabled = 1 ORDER BY position, id',
    )
    .all() as LocalhostRow[]

  return rows.map(toRecord)
}

/**
 * Lists every port, including the disabled ones, for the admin view.
 * @returns {ReadonlyArray<ApiLocalhostPort & { enabled: boolean }>} - Ports, ordered by position
 */
export function listAllLocalhost(): ReadonlyArray<ApiLocalhostPort & { enabled: boolean }> {
  const rows = getDb()
    .prepare(
      'SELECT id, scheme, port, keywords, position, enabled FROM localhost_ports ORDER BY position, id',
    )
    .all() as LocalhostRow[]

  return rows.map((row) => ({ ...toRecord(row), enabled: row.enabled === 1 }))
}

/**
 * Adds a port after the last one.
 * @param {CreateLocalhostInput} input - Validated scheme and port
 * @returns {ApiLocalhostPort} - The stored port
 */
export function createLocalhost(input: CreateLocalhostInput): ApiLocalhostPort {
  const db = getDb()

  try {
    const row = db
      .prepare(
        `INSERT INTO localhost_ports (scheme, port, keywords, position) VALUES (?, ?, ?, ?)
         RETURNING id, scheme, port, keywords, position, enabled`,
      )
      .get(
        input.scheme,
        input.port,
        JSON.stringify(input.keywords),
        nextPosition('localhost_ports'),
      ) as LocalhostRow

    return toRecord(row)
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw badRequest(`${input.scheme}://localhost:${input.port} is already listed`)
    }

    throw error
  }
}

/**
 * Changes a port's scheme or number.
 * @param {number} id - Port to update
 * @param {UpdateLocalhostInput} input - Fields to change
 * @returns {ApiLocalhostPort} - The updated port
 */
export function updateLocalhost(id: number, input: UpdateLocalhostInput): ApiLocalhostPort {
  const assignments: string[] = []
  const params: Record<string, unknown> = { id }

  if (input.scheme !== undefined) {
    assignments.push('scheme = @scheme')
    params.scheme = input.scheme
  }

  if (input.port !== undefined) {
    assignments.push('port = @port')
    params.port = input.port
  }

  if (input.keywords !== undefined) {
    assignments.push('keywords = @keywords')
    params.keywords = JSON.stringify(input.keywords)
  }

  try {
    const row = getDb()
      .prepare(
        `UPDATE localhost_ports SET ${assignments.join(', ')}, updated_at = datetime('now')
         WHERE id = @id
         RETURNING id, scheme, port, keywords, position, enabled`,
      )
      .get(params) as LocalhostRow | undefined

    if (!row) {
      throw notFound('port not found')
    }

    return toRecord(row)
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw badRequest('that scheme and port are already listed')
    }

    throw error
  }
}

/**
 * Turns one port on or off without removing it.
 * @param {number} id - Port to toggle
 * @param {boolean} enabled - Whether the portal should probe it
 * @returns {void}
 */
export function setLocalhostRowEnabled(id: number, enabled: boolean): void {
  setRowEnabled('localhost_ports', id, enabled, 'port not found')
}

/**
 * Removes a port.
 * @param {number} id - Port to delete
 * @returns {void}
 */
export function deleteLocalhost(id: number): void {
  deleteRow('localhost_ports', id, 'port not found')
}

/**
 * Rewrites the order of the ports.
 * @param {ReadonlyArray<number>} ids - Ids in their new order
 * @returns {void}
 */
export function reorderLocalhost(ids: ReadonlyArray<number>): void {
  reorderRows('localhost_ports', ids)
}

/**
 * Maps a stored row onto the shape the API serves, deriving the url.
 * @param {LocalhostRow} row - Row as sqlite returned it
 * @returns {ApiLocalhostPort} - Port with its url
 */
function toRecord(row: LocalhostRow): ApiLocalhostPort {
  return {
    id: row.id,
    ref: portRef(row.id),
    scheme: row.scheme,
    port: row.port,
    keywords: parseStringArray(row.keywords ?? '[]'),
    label: `localhost:${row.port}`,
    url: `${row.scheme}://localhost:${row.port}`,
    position: row.position,
  }
}
