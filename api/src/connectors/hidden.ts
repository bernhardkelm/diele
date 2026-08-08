import { getDb } from '#db/index.js'

/**
 * Who a hidden entry is hidden for. `all` is the portal's own choice and only an admin makes
 * it; `mine` is one person's, and says nothing about what anyone else sees.
 */
export type HiddenScope = 'all' | 'mine'

export interface HiddenRefs {
  /** Hidden for everyone, by an admin */
  readonly all: ReadonlyArray<string>
  /** Hidden by the person asking, for themselves */
  readonly mine: ReadonlyArray<string>
}

/**
 * Reads both hidden sets for one person.
 * @param {number} userId - Whoever is asking
 * @returns {HiddenRefs} - What is hidden for everyone, and what they hid themselves
 */
export function readHidden(userId: number): HiddenRefs {
  const rows = getDb()
    .prepare('SELECT ref, user_id FROM hidden_entries WHERE user_id IS NULL OR user_id = ?')
    .all(userId) as Array<{ ref: string; user_id: number | null }>

  return {
    all: rows.filter((row) => row.user_id === null).map((row) => row.ref),
    mine: rows.filter((row) => row.user_id !== null).map((row) => row.ref),
  }
}

/**
 * Hides an entry, or brings it back, in one of the two scopes.
 * @param {string} ref - Entry being hidden
 * @param {HiddenScope} scope - Whether this is the portal's choice or one person's
 * @param {number} userId - Whoever is asking, ignored for the `all` scope
 * @param {boolean} hidden - True to hide it, false to bring it back
 * @returns {void}
 */
export function setHidden(ref: string, scope: HiddenScope, userId: number, hidden: boolean): void {
  const db = getDb()
  const owner = scope === 'all' ? null : userId

  if (!hidden) {
    db.prepare(
      'DELETE FROM hidden_entries WHERE ref = ? AND COALESCE(user_id, 0) = COALESCE(?, 0)',
    ).run(ref, owner)
    return
  }

  db.prepare(
    `INSERT INTO hidden_entries (ref, user_id) VALUES (?, ?)
     ON CONFLICT (ref, COALESCE(user_id, 0)) DO NOTHING`,
  ).run(ref, owner)
}
