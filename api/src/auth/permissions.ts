import type { SessionUser } from './session.js'

/**
 * Returns whether a user may change the portal's configuration.
 *
 * Stored on the account rather than derived, and set for every account that already existed
 * and every later issuer login, so this answers exactly as it did before the flag existed.
 * Only accounts created through the user editor can start without it.
 *
 * Group-based rules are still the open question, and this stays the single place they land:
 * the session already carries the issuer's group claims.
 * @param {SessionUser} user - The signed-in user
 * @returns {boolean} - True when the user may administer the portal
 */
export function canAdmin(user: SessionUser): boolean {
  return user.isAdmin
}
