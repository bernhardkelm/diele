import { parseStringArray } from '#db/json.js'
import { getHistoryDb, peekHistoryDb } from './db.js'

export interface HistoryPreferences {
  readonly enabled: boolean
  readonly excludedDomains: ReadonlyArray<string>
}

export interface StoredPreferences extends HistoryPreferences {
  /** Moves on every delete the account asks for */
  readonly forgetEpoch: number
}

/** What an account that never said anything has: nothing recorded. */
const DEFAULTS: StoredPreferences = { enabled: false, excludedDomains: [], forgetEpoch: 0 }

/**
 * Reads an account's own choices about its history.
 * @param {string | undefined} owner - The account's history key, undefined when it has none
 * @returns {StoredPreferences} - Whether it opted in, what it never wants recorded, and its epoch
 */
export function readPreferences(owner: string | undefined): StoredPreferences {
  if (owner === undefined) {
    return DEFAULTS
  }

  const row = peekHistoryDb()
    ?.prepare(
      'SELECT enabled, excluded_domains, forget_epoch FROM history_preferences WHERE owner = ?',
    )
    .get(owner) as { enabled: number; excluded_domains: string; forget_epoch: number } | undefined

  if (!row) {
    return DEFAULTS
  }

  return {
    enabled: row.enabled === 1,
    excludedDomains: parseStringArray(row.excluded_domains),
    forgetEpoch: row.forget_epoch,
  }
}

/**
 * Stores an account's choices, whole. The caller merges a partial change first.
 * @param {string} owner - The account's history key
 * @param {HistoryPreferences} preferences - The complete new choices
 * @returns {void}
 */
export function writePreferences(owner: string, preferences: HistoryPreferences): void {
  getHistoryDb()
    .prepare(
      `INSERT INTO history_preferences (owner, enabled, excluded_domains)
       VALUES (?, ?, ?)
       ON CONFLICT (owner) DO UPDATE SET
         enabled          = excluded.enabled,
         excluded_domains = excluded.excluded_domains,
         updated_at       = datetime('now')`,
    )
    .run(owner, preferences.enabled ? 1 : 0, JSON.stringify(preferences.excludedDomains))
}

/**
 * Moves an account's forget epoch on, so a probe that started before a delete writes nothing.
 * @param {string} owner - The account's history key
 * @returns {void}
 */
export function bumpForgetEpoch(owner: string): void {
  getHistoryDb()
    .prepare(
      `INSERT INTO history_preferences (owner, forget_epoch) VALUES (?, 1)
       ON CONFLICT (owner) DO UPDATE SET forget_epoch = forget_epoch + 1`,
    )
    .run(owner)
}
