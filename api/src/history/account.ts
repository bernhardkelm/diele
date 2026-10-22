import { createHash } from 'node:crypto'

/** Keeps this digest apart from any other made of the same key. */
const LABEL = 'diele history account v1'

/**
 * Derives the opaque tag a source can tell this account's history apart by, such as the
 * extension deciding whether what it buffered belongs to the account now signed in. A one-way
 * digest of the history key: stable for as long as the key, and neither the key nor the user id,
 * which can be handed out again after the main database is reset.
 * @param {string} owner - The account's history key
 * @returns {string} - 22 base64url characters
 */
export function accountTag(owner: string): string {
  return createHash('sha256').update(`${LABEL}\n${owner}`).digest('base64url').slice(0, 22)
}
