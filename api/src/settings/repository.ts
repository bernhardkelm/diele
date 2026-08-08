import { getDb } from '#db/index.js'

interface SettingRow {
  key: string
  value: string
}

/**
 * Reads every setting as a plain object. Values are stored as JSON so a setting can hold
 * more than a string without the table growing a type column.
 * @returns {Record<string, unknown>} - Settings by key, skipping any value that will not parse
 */
export function readSettings(): Record<string, unknown> {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as SettingRow[]

  const settings: Record<string, unknown> = {}

  for (const row of rows) {
    try {
      settings[row.key] = JSON.parse(row.value)
    } catch {
      // a value written by hand rather than by the API is not worth failing the whole payload
    }
  }

  return settings
}

/**
 * Reads one setting.
 * @param {string} key - Setting to read
 * @returns {unknown} - Its parsed value, or undefined when unset or unreadable
 */
export function readSetting(key: string): unknown {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined

  if (!row) {
    return undefined
  }

  try {
    return JSON.parse(row.value)
  } catch {
    return undefined
  }
}

/**
 * Writes one setting, replacing whatever was there.
 * @param {string} key - Setting to write
 * @param {unknown} value - Value to store, serialised as JSON
 * @returns {void}
 */
export function writeSetting(key: string, value: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, JSON.stringify(value))
}
