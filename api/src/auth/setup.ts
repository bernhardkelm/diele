import { randomBytes, timingSafeEqual } from 'node:crypto'
import { config } from '#config.js'
import { countLocalUsers } from '#users/repository.js'

let generated: string | null = null

/**
 * Returns whether the portal is waiting for its first account to be created.
 *
 * Keyed on local accounts rather than on the table being empty: a database developed against
 * `AUTH_MODE=dev` already holds a row for the fixed dev identity, and treating that as "someone
 * has signed up" would lock the operator out of a portal that has no way in yet.
 * @returns {boolean} - True when setup should be offered
 */
export function setupPending(): boolean {
  return config.authMode === 'local' && countLocalUsers() === 0
}

/**
 * Returns the token a setup request has to carry, generating one on first use when the
 * environment did not supply it.
 * @returns {string} - The expected setup token
 */
export function setupToken(): string {
  if (config.local.setupToken) {
    return config.local.setupToken
  }

  generated ??= randomBytes(24).toString('base64url')
  return generated
}

/**
 * Returns whether a supplied token matches, comparing in constant time.
 * @param {string} supplied - Token from the request body
 * @returns {boolean} - True when it matches
 */
export function setupTokenMatches(supplied: string): boolean {
  const expected = Buffer.from(setupToken())
  const given = Buffer.from(supplied)

  if (expected.length !== given.length) {
    return false
  }

  return timingSafeEqual(expected, given)
}

/**
 * Prints the setup token at boot while the portal is still unclaimed, which is the only place
 * an operator can read it when the environment did not set one.
 * @returns {void}
 */
export function announceSetup(): void {
  if (!setupPending()) {
    return
  }

  const source = config.local.setupToken ? 'LOCAL_SETUP_TOKEN' : 'generated for this run'

  console.warn(
    `\nThis portal has no account yet. Open it and create one with this token (${source}):\n\n` +
      `    ${setupToken()}\n\n` +
      'Anyone who reaches the portal before you do can claim it, so set it up now.\n',
  )
}
