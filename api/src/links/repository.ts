import type { ApiLink, LinkKind } from '@diele/common'
import { linkRef } from '#connectors/refs.js'
import { getDb } from '#db/index.js'
import { deleteRow, nextPosition, reorderRows, setRowEnabled } from '#db/orderedRows.js'
import { parseStringArray } from '#db/json.js'
import { notFound } from '#errors.js'
import type { CreateLinkInput, UpdateLinkInput } from './schemas.js'

interface LinkRow {
  id: number
  kind: LinkKind
  label: string
  url: string
  display: string | null
  keywords: string
  icon: string | null
  icon_id: number | null
  color: string | null
  position: number
}

const SELECT = `
  SELECT l.id, l.kind, l.label, l.url, l.display, l.keywords, l.icon_id, l.color,
         l.position, i.svg AS icon
  FROM links l
  LEFT JOIN icons i ON i.id = l.icon_id
`

/**
 * Lists the enabled links of one kind, in the order they should render.
 * @param {LinkKind} kind - Which section to read, cards or saved sites
 * @returns {ReadonlyArray<ApiLink>} - Links, ordered by position
 */
export function listLinks(kind: LinkKind): ReadonlyArray<ApiLink> {
  const rows = getDb()
    .prepare(`${SELECT} WHERE l.kind = ? AND l.enabled = 1 ORDER BY l.position, l.id`)
    .all(kind) as LinkRow[]

  return rows.map(toRecord)
}

/**
 * Lists every link of one kind, including the disabled ones, for the admin view.
 * @param {LinkKind} kind - Which section to read
 * @returns {ReadonlyArray<ApiLink & { enabled: boolean }>} - Links, ordered by position
 */
export function listAllLinks(kind: LinkKind): ReadonlyArray<ApiLink & { enabled: boolean }> {
  const rows = getDb()
    .prepare(
      `${SELECT.replace('l.position', 'l.position, l.enabled')} WHERE l.kind = ? ORDER BY l.position, l.id`,
    )
    .all(kind) as Array<LinkRow & { enabled: number }>

  return rows.map((row) => ({ ...toRecord(row), enabled: row.enabled === 1 }))
}

/**
 * Reads one link back after a write.
 * @param {number} id - Link to read
 * @returns {ApiLink} - The stored link
 */
function readLink(id: number): ApiLink {
  const row = getDb().prepare(`${SELECT} WHERE l.id = ?`).get(id) as LinkRow | undefined
  if (!row) {
    throw notFound('link not found')
  }

  return toRecord(row)
}

/**
 * Appends a link after the last one of its kind.
 * @param {CreateLinkInput} input - Validated link to store
 * @returns {ApiLink} - The stored link, with its assigned id and position
 */
export function createLink(input: CreateLinkInput): ApiLink {
  const db = getDb()

  const result = db
    .prepare(
      `INSERT INTO links (kind, label, url, display, keywords, icon_id, color, position)
       VALUES (@kind, @label, @url, @display, @keywords, @iconId, @color, @position)`,
    )
    .run({
      kind: input.kind,
      label: input.label,
      url: input.url,
      display: input.display ?? null,
      keywords: JSON.stringify(input.keywords),
      iconId: input.iconId ?? null,
      color: input.color ?? null,
      position: nextPosition('links', { column: 'kind', value: input.kind }),
    })

  return readLink(Number(result.lastInsertRowid))
}

/**
 * Applies a partial update to one link.
 * @param {number} id - Link to update
 * @param {UpdateLinkInput} input - Fields to change; absent ones are left alone
 * @returns {ApiLink} - The updated link
 */
export function updateLink(id: number, input: UpdateLinkInput): ApiLink {
  // Allowlisted rather than taken from the body's keys: these names are interpolated into
  // SQL, so they must come from here and never from the request, whatever zod already
  // stripped.
  const COLUMNS = {
    label: 'label',
    url: 'url',
    display: 'display',
    keywords: 'keywords',
    iconId: 'icon_id',
    color: 'color',
  } as const

  const assignments: string[] = []
  const params: Record<string, unknown> = { id }

  for (const [key, column] of Object.entries(COLUMNS) as Array<[keyof typeof COLUMNS, string]>) {
    if (!(key in input)) {
      continue
    }

    const value = input[key]
    assignments.push(`${column} = @${key}`)
    params[key] = key === 'keywords' ? JSON.stringify(value) : (value ?? null)
  }

  if (assignments.length === 0) {
    throw notFound('no fields to update')
  }

  const result = getDb()
    .prepare(
      `UPDATE links SET ${assignments.join(', ')}, updated_at = datetime('now') WHERE id = @id`,
    )
    .run(params)

  if (result.changes === 0) {
    throw notFound('link not found')
  }

  return readLink(id)
}

/**
 * Turns a link on or off without deleting it.
 * @param {number} id - Link to toggle
 * @param {boolean} enabled - Whether the portal should show it
 * @returns {void}
 */
export function setLinkEnabled(id: number, enabled: boolean): void {
  setRowEnabled('links', id, enabled, 'link not found')
}

/**
 * Removes a link.
 * @param {number} id - Link to delete
 * @returns {void}
 */
export function deleteLink(id: number): void {
  deleteRow('links', id, 'link not found')
}

/**
 * Rewrites the positions of one kind to the given order, in one transaction so a failure
 * cannot leave half the section renumbered.
 * @param {LinkKind} kind - Section being reordered
 * @param {ReadonlyArray<number>} ids - Ids in their new order
 * @returns {void}
 */
export function reorderLinks(kind: LinkKind, ids: ReadonlyArray<number>): void {
  reorderRows('links', ids, { column: 'kind', value: kind })
}

/**
 * Maps a stored row onto the shape the API serves, parsing the JSON columns.
 * @param {LinkRow} row - Row as sqlite returned it
 * @returns {ApiLink} - Link with its keywords parsed
 */
function toRecord(row: LinkRow): ApiLink {
  return {
    id: row.id,
    ref: linkRef(row.kind, row.id),
    kind: row.kind,
    label: row.label,
    url: row.url,
    display: row.display,
    keywords: parseStringArray(row.keywords),
    icon: row.icon,
    iconId: row.icon_id,
    color: row.color,
    position: row.position,
  }
}
