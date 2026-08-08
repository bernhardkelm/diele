import type { ApiCommand } from '@diele/common'
import { commandRef } from '#connectors/refs.js'
import { getDb } from '#db/index.js'
import { deleteRow, nextPosition, reorderRows, setRowEnabled } from '#db/orderedRows.js'
import { badRequest, isUniqueConstraintError, notFound } from '#errors.js'
import type { CreateCommandInput, UpdateCommandInput } from './schemas.js'

/**
 * The commands the portal answers to without anyone configuring them. They navigate rather
 * than search, so they are not rows and cannot be edited - but the admin list shows them, so
 * the two kinds are visible in one place and a keyword collision is obvious.
 */
export const BUILT_IN_COMMANDS: ReadonlyArray<{ keyword: string; label: string }> = [
  { keyword: 'admin', label: 'Open the admin panel' },
  { keyword: 'settings', label: 'Open the settings menu' },
  { keyword: 'logout', label: 'End the session' },
]

interface CommandRow {
  id: number
  keyword: string
  label: string | null
  url_template: string
  position: number
  enabled: number
}

/**
 * Lists the enabled commands the portal should offer.
 * @returns {ReadonlyArray<ApiCommand>} - Commands, ordered by position
 */
export function listCommands(): ReadonlyArray<ApiCommand> {
  const rows = getDb()
    .prepare(
      `SELECT id, keyword, label, url_template, position, enabled FROM slash_commands
       WHERE enabled = 1 ORDER BY position, id`,
    )
    .all() as CommandRow[]

  return rows.map(toRecord)
}

/**
 * Lists every command, including the disabled ones, for the admin view.
 * @returns {ReadonlyArray<ApiCommand & { enabled: boolean }>} - Commands, ordered by position
 */
export function listAllCommands(): ReadonlyArray<ApiCommand & { enabled: boolean }> {
  const rows = getDb()
    .prepare(
      `SELECT id, keyword, label, url_template, position, enabled FROM slash_commands
       ORDER BY position, id`,
    )
    .all() as CommandRow[]

  return rows.map((row) => ({ ...toRecord(row), enabled: row.enabled === 1 }))
}

/**
 * Returns whether the portal already answers to a keyword itself.
 * @param {string} keyword - Keyword being stored
 * @returns {boolean} - True when a built-in command owns it
 */
export function isBuiltInKeyword(keyword: string): boolean {
  return BUILT_IN_COMMANDS.some((entry) => entry.keyword === keyword)
}

/**
 * Rejects a keyword the portal already answers to itself, so a command cannot shadow the
 * admin panel and leave someone unable to reach it.
 * @param {string} keyword - Keyword being stored
 * @returns {void}
 */
function refuseBuiltIn(keyword: string): void {
  if (isBuiltInKeyword(keyword)) {
    throw badRequest(`/${keyword} is built in and cannot be redefined`)
  }
}

/**
 * Adds a command after the last one.
 * @param {CreateCommandInput} input - Validated keyword and template
 * @returns {ApiCommand} - The stored command
 */
export function createCommand(input: CreateCommandInput): ApiCommand {
  refuseBuiltIn(input.keyword)

  const db = getDb()
  try {
    const row = db
      .prepare(
        `INSERT INTO slash_commands (keyword, label, url_template, position)
         VALUES (?, ?, ?, ?)
         RETURNING id, keyword, label, url_template, position, enabled`,
      )
      .get(
        input.keyword,
        input.label ?? null,
        input.urlTemplate,
        nextPosition('slash_commands'),
      ) as CommandRow

    return toRecord(row)
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw badRequest(`/${input.keyword} is already defined`)
    }

    throw error
  }
}

/**
 * Applies a partial update to one command.
 * @param {number} id - Command to update
 * @param {UpdateCommandInput} input - Fields to change
 * @returns {ApiCommand} - The updated command
 */
export function updateCommand(id: number, input: UpdateCommandInput): ApiCommand {
  if (input.keyword !== undefined) {
    refuseBuiltIn(input.keyword)
  }

  const assignments: string[] = []
  const params: Record<string, unknown> = { id }

  if (input.keyword !== undefined) {
    assignments.push('keyword = @keyword')
    params.keyword = input.keyword
  }

  if (input.label !== undefined) {
    assignments.push('label = @label')
    params.label = input.label ?? null
  }

  if (input.urlTemplate !== undefined) {
    assignments.push('url_template = @urlTemplate')
    params.urlTemplate = input.urlTemplate
  }

  try {
    const row = getDb()
      .prepare(
        `UPDATE slash_commands SET ${assignments.join(', ')}, updated_at = datetime('now')
         WHERE id = @id
         RETURNING id, keyword, label, url_template, position, enabled`,
      )
      .get(params) as CommandRow | undefined

    if (!row) {
      throw notFound('command not found')
    }

    return toRecord(row)
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw badRequest('that keyword is already defined')
    }

    throw error
  }
}

/**
 * Turns one command on or off without removing it.
 * @param {number} id - Command to toggle
 * @param {boolean} enabled - Whether the portal should offer it
 * @returns {void}
 */
export function setCommandEnabled(id: number, enabled: boolean): void {
  setRowEnabled('slash_commands', id, enabled, 'command not found')
}

/**
 * Removes a command.
 * @param {number} id - Command to delete
 * @returns {void}
 */
export function deleteCommand(id: number): void {
  deleteRow('slash_commands', id, 'command not found')
}

/**
 * Rewrites the order of the commands.
 * @param {ReadonlyArray<number>} ids - Ids in their new order
 * @returns {void}
 */
export function reorderCommands(ids: ReadonlyArray<number>): void {
  reorderRows('slash_commands', ids)
}

/**
 * Maps a stored row onto the shape the API serves.
 * @param {CommandRow} row - Row as sqlite returned it
 * @returns {ApiCommand} - Command in wire shape
 */
function toRecord(row: CommandRow): ApiCommand {
  return {
    id: row.id,
    ref: commandRef(row.id),
    keyword: row.keyword,
    label: row.label,
    urlTemplate: row.url_template,
    position: row.position,
  }
}
