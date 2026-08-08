import { getDb } from '#db/index.js'

// Long enough that guessing at any useful rate trips it, short enough that locking yourself out
// with a typo costs a coffee rather than an afternoon.
const WINDOW = '-15 minutes'

// Counted per username *and* address together, never per username alone. A portal in local mode
// usually has exactly one account, so blocking a username outright would let anyone deny the
// only operator access with ten cheap requests. Pairing them means an attacker blocks only
// themselves, and the operator signing in from anywhere else is unaffected.
const PER_PAIR = 10

// The second half of that trade: pairing alone would let one address work through a list of
// usernames unchecked, so an address is also capped across every name it tries.
const PER_IP = 30

interface Counts {
  pair: number
  ip: number
}

/**
 * Returns whether this username and address have failed too often to be allowed another try.
 * @param {string} username - Normalised username being attempted
 * @param {string} ip - Address the attempt came from
 * @returns {boolean} - True when the attempt should be refused without checking the password
 */
export function tooManyAttempts(username: string, ip: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT
         COUNT(*) FILTER (WHERE username = @username AND ip = @ip) AS pair,
         COUNT(*) FILTER (WHERE ip = @ip)                          AS ip
       FROM login_attempts
       WHERE created_at > datetime('now', @window)`,
    )
    .get({ username, ip, window: WINDOW }) as Counts

  return row.pair >= PER_PAIR || row.ip >= PER_IP
}

/**
 * Records an attempt.
 *
 * Written before the password is checked, not after: deriving a hash takes long enough that a
 * burst of requests would otherwise all read a count of zero, all pass, and all queue work.
 * @param {string} username - Normalised username that was attempted
 * @param {string} ip - Address the attempt came from
 * @returns {void}
 */
export function recordAttempt(username: string, ip: string): void {
  getDb().prepare('INSERT INTO login_attempts (username, ip) VALUES (?, ?)').run(username, ip)
}

/**
 * Clears an account's attempts once it signs in, so someone who eventually remembers their
 * password is not still held out by the tries that got them there.
 * @param {string} username - Normalised username that just signed in
 * @returns {void}
 */
export function clearAttempts(username: string): void {
  getDb().prepare('DELETE FROM login_attempts WHERE username = ?').run(username)
}

/**
 * Drops attempts old enough to be outside the window.
 * @returns {void}
 */
export function pruneAttempts(): void {
  getDb().prepare(`DELETE FROM login_attempts WHERE created_at <= datetime('now', ?)`).run(WINDOW)
}
