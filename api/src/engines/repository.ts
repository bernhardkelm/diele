import type { ApiSearchEngine } from '@diele/common'
import { getDb } from '#db/index.js'
import { deleteRow, nextPosition, reorderRows, setRowEnabled } from '#db/orderedRows.js'
import { notFound } from '#errors.js'
import type { CreateEngineInput, UpdateEngineInput } from './schemas.js'

interface EngineRow {
  id: number
  name: string
  url_template: string
  position: number
}

/**
 * Lists the enabled search engines in the order the bar cycles through them.
 * @returns {ReadonlyArray<ApiSearchEngine>} - Engines, ordered by position
 */
export function listEngines(): ReadonlyArray<ApiSearchEngine> {
  const rows = getDb()
    .prepare(
      `SELECT id, name, url_template, position
       FROM search_engines
       WHERE enabled = 1
       ORDER BY position, id`,
    )
    .all() as EngineRow[]

  return rows.map(toRecord)
}

/**
 * Lists every engine, including the disabled ones, for the admin view.
 * @returns {ReadonlyArray<ApiSearchEngine & { enabled: boolean }>} - Engines, ordered by position
 */
export function listAllEngines(): ReadonlyArray<ApiSearchEngine & { enabled: boolean }> {
  const rows = getDb()
    .prepare(
      `SELECT id, name, url_template, position, enabled
       FROM search_engines
       ORDER BY position, id`,
    )
    .all() as Array<EngineRow & { enabled: number }>

  return rows.map((row) => ({ ...toRecord(row), enabled: row.enabled === 1 }))
}

/**
 * Appends an engine after the last one.
 * @param {CreateEngineInput} input - Validated engine to store
 * @returns {ApiSearchEngine} - The stored engine, with its assigned id and position
 */
export function createEngine(input: CreateEngineInput): ApiSearchEngine {
  const db = getDb()

  const row = db
    .prepare(
      `INSERT INTO search_engines (name, url_template, position)
       VALUES (@name, @urlTemplate, @position)
       RETURNING id, name, url_template, position`,
    )
    .get({
      name: input.name,
      urlTemplate: input.urlTemplate,
      position: nextPosition('search_engines'),
    }) as EngineRow

  return toRecord(row)
}

/**
 * Applies a partial update to one engine.
 * @param {number} id - Engine to update
 * @param {UpdateEngineInput} input - Fields to change; absent ones are left alone
 * @returns {ApiSearchEngine} - The updated engine
 */
export function updateEngine(id: number, input: UpdateEngineInput): ApiSearchEngine {
  const assignments: string[] = []
  const params: Record<string, unknown> = { id }

  if (input.name !== undefined) {
    assignments.push('name = @name')
    params.name = input.name
  }

  if (input.urlTemplate !== undefined) {
    assignments.push('url_template = @urlTemplate')
    params.urlTemplate = input.urlTemplate
  }

  const row = getDb()
    .prepare(
      `UPDATE search_engines SET ${assignments.join(', ')}, updated_at = datetime('now')
       WHERE id = @id
       RETURNING id, name, url_template, position`,
    )
    .get(params) as EngineRow | undefined

  if (!row) {
    throw notFound('search engine not found')
  }

  return toRecord(row)
}

/**
 * Turns an engine on or off without deleting it.
 * @param {number} id - Engine to toggle
 * @param {boolean} enabled - Whether the bar should offer it
 * @returns {void}
 */
export function setEngineEnabled(id: number, enabled: boolean): void {
  setRowEnabled('search_engines', id, enabled, 'search engine not found')
}

/**
 * Removes an engine.
 * @param {number} id - Engine to delete
 * @returns {void}
 */
export function deleteEngine(id: number): void {
  deleteRow('search_engines', id, 'search engine not found')
}

/**
 * Rewrites every position to the given order, in one transaction. The first entry is the
 * default the bar starts on, so this is also how the default is chosen.
 * @param {ReadonlyArray<number>} ids - Ids in their new order
 * @returns {void}
 */
export function reorderEngines(ids: ReadonlyArray<number>): void {
  reorderRows('search_engines', ids)
}

/**
 * Maps a stored row onto the shape the API serves.
 * @param {EngineRow} row - Row as sqlite returned it
 * @returns {ApiSearchEngine} - Engine in wire shape
 */
function toRecord(row: EngineRow): ApiSearchEngine {
  return {
    id: row.id,
    name: row.name,
    urlTemplate: row.url_template,
    position: row.position,
  }
}
