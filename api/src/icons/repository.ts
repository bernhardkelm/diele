import type { ApiIcon } from '@diele/common'
import { getDb } from '#db/index.js'
import { notFound } from '#errors.js'
import { sanitizeSvg } from './sanitize.js'

/**
 * Sanitises an uploaded SVG and stores it. Sanitising on the way in rather than on the way
 * out means the database only ever holds markup that is safe to inline, so a later reader
 * cannot forget to clean it.
 * @param {string} name - Name shown in the picker
 * @param {string} source - Raw SVG markup as uploaded
 * @returns {ApiIcon} - The stored icon
 */
export function createIcon(name: string, source: string): ApiIcon {
  const svg = sanitizeSvg(source)

  const row = getDb()
    .prepare('INSERT INTO icons (name, svg) VALUES (?, ?) RETURNING id, name, svg')
    .get(name, svg) as ApiIcon

  return row
}

/**
 * Lists the uploaded icons.
 * @returns {ReadonlyArray<ApiIcon>} - Icons, newest last
 */
export function listIcons(): ReadonlyArray<ApiIcon> {
  return getDb().prepare('SELECT id, name, svg FROM icons ORDER BY id').all() as ApiIcon[]
}

/**
 * Removes an icon. Cards referencing it keep working and simply lose their logo, because the
 * reference is cleared rather than the card deleted.
 * @param {number} id - Icon to delete
 * @returns {void}
 */
export function deleteIcon(id: number): void {
  const result = getDb().prepare('DELETE FROM icons WHERE id = ?').run(id)

  if (result.changes === 0) {
    throw notFound('icon not found')
  }
}
