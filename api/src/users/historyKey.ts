import { randomBytes } from 'node:crypto'
import { getDb } from '#db/index.js'

/** 128 bits, so a key is never guessed and never collides. */
const KEY_BYTES = 16

/**
 * Reads the key an account's history is filed under, without creating one.
 * @param {number} userId - Account to read
 * @returns {string | undefined} - The key, or undefined for an account that never touched history
 */
export function readHistoryKey(userId: number): string | undefined {
  const row = getDb().prepare('SELECT history_key FROM users WHERE id = ?').get(userId) as
    | { history_key: string | null }
    | undefined

  return row?.history_key ?? undefined
}

/**
 * Returns the key an account's history is filed under, creating it on first use. Written only
 * where none is set yet, so two first calls racing each other agree on the one that landed.
 * @param {number} userId - Account to read
 * @returns {string} - The account's key
 */
export function ensureHistoryKey(userId: number): string {
  getDb()
    .prepare('UPDATE users SET history_key = ? WHERE id = ? AND history_key IS NULL')
    .run(randomBytes(KEY_BYTES).toString('base64url'), userId)

  const key = readHistoryKey(userId)
  if (!key) {
    throw new Error('the account no longer exists')
  }

  return key
}

/**
 * Lists every key an existing account holds, which is what the history prune keeps.
 * @returns {ReadonlyArray<string>} - Keys in use
 */
export function listHistoryKeys(): ReadonlyArray<string> {
  const rows = getDb()
    .prepare('SELECT history_key FROM users WHERE history_key IS NOT NULL')
    .all() as Array<{ history_key: string }>

  return rows.map((row) => row.history_key)
}
