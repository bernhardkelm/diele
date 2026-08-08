import { getDb } from '#db/index.js'
import { notFound } from '#errors.js'

// Positions are spaced so a row can be moved between two others without renumbering the rest.
export const POSITION_STEP = 10

/** Narrows an operation to one section of a table, for the tables that hold more than one */
export interface RowScope {
  readonly column: string
  readonly value: string | number
}

// Table and column names cannot be bound as parameters, so they are interpolated. Every caller
// in this codebase passes a literal it wrote itself; nothing here may ever take one from a
// request, which is the one thing that would turn this into an injection point.

/**
 * Returns the position a row appended to a table should take.
 * @param {string} table - Table to append to
 * @param {RowScope | undefined} scope - Section to append within, when the table holds several
 * @returns {number} - Position for the new row
 */
export function nextPosition(table: string, scope?: RowScope): number {
  const where = scope ? ` WHERE ${scope.column} = ?` : ''
  const row = getDb()
    .prepare(`SELECT COALESCE(MAX(position), 0) AS position FROM ${table}${where}`)
    .get(...(scope ? [scope.value] : [])) as { position: number }

  return row.position + POSITION_STEP
}

/**
 * Turns one row on or off, which is not the same as deleting it.
 * @param {string} table - Table holding the row
 * @param {number} id - Row to switch
 * @param {boolean} enabled - Whether it should be on
 * @param {string} missing - Message for the 404 when no row has that id
 * @returns {void}
 */
export function setRowEnabled(table: string, id: number, enabled: boolean, missing: string): void {
  const result = getDb()
    .prepare(`UPDATE ${table} SET enabled = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(enabled ? 1 : 0, id)

  if (result.changes === 0) {
    throw notFound(missing)
  }
}

/**
 * Removes one row.
 * @param {string} table - Table holding the row
 * @param {number} id - Row to delete
 * @param {string} missing - Message for the 404 when no row has that id
 * @returns {void}
 */
export function deleteRow(table: string, id: number, missing: string): void {
  const result = getDb().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id)

  if (result.changes === 0) {
    throw notFound(missing)
  }
}

/**
 * Rewrites positions to the given order, in one transaction so a failure cannot leave half a
 * section renumbered.
 * @param {string} table - Table to reorder
 * @param {ReadonlyArray<number>} ids - Ids in their new order
 * @param {RowScope | undefined} scope - Section being reordered, when the table holds several
 * @returns {void}
 */
export function reorderRows(table: string, ids: ReadonlyArray<number>, scope?: RowScope): void {
  const db = getDb()
  const where = scope ? ` AND ${scope.column} = ?` : ''
  const update = db.prepare(`UPDATE ${table} SET position = ? WHERE id = ?${where}`)

  db.transaction(() => {
    ids.forEach((id, index) => {
      const position = (index + 1) * POSITION_STEP
      if (scope) {
        update.run(position, id, scope.value)
        return
      }

      update.run(position, id)
    })
  })()
}
