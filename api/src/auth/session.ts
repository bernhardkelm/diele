import { createHash, randomBytes } from 'node:crypto'
import { config } from '#config.js'
import { getDb } from '#db/index.js'
import { parseStringArray } from '#db/json.js'
import { pruneAttempts } from './attempts.js'

export interface SessionUser {
  readonly id: number
  readonly issuer: string
  readonly subject: string
  readonly email: string | null
  readonly name: string | null
  readonly picture: string | null
  /** Whether the account may change the portal's configuration */
  readonly isAdmin: boolean
  /** Claims carried from the issuer; unused until roles land, stored so they are there when it does */
  readonly groups: ReadonlyArray<string>
}

export interface IdentityClaims {
  readonly issuer: string
  readonly subject: string
  readonly email?: string | null
  readonly name?: string | null
  readonly picture?: string | null
  readonly groups?: ReadonlyArray<string>
}

interface UserRow {
  id: number
  issuer: string
  subject: string
  email: string | null
  name: string | null
  picture: string | null
  is_admin: number
}

interface SessionRow extends UserRow {
  groups: string
}

// A session id is the bearer of the whole session, so it is a raw 256-bit random value and
// never anything derived from the user.
const SESSION_ID_BYTES = 32

// Every request would otherwise write to sqlite just to move last_seen_at by milliseconds.
const TOUCH_AFTER = '-1 hours'

/**
 * Derives what a session is stored under. The cookie carries the token itself and the table holds
 * only this, so a read of the database file yields nothing that can be presented as a session the
 * way the raw value could.
 *
 * A plain digest rather than a password hash: the token is 256 bits of randomness, so there is no
 * candidate set to search, and every request has to pay for this.
 * @param {string} token - Session token as it arrives from the cookie
 * @returns {string} - Lookup key for the sessions table
 */
function sessionKey(token: string): string {
  return createHash('sha256').update(token).digest('base64url')
}

/**
 * Records the identity an issuer vouched for, creating it on first login and refreshing the
 * profile fields on every later one.
 * @param {IdentityClaims} claims - Claims taken from the id token
 * @returns {number} - Local user id
 */
export function upsertUser(claims: IdentityClaims): number {
  const db = getDb()

  const row = db
    .prepare(
      `INSERT INTO users (issuer, subject, email, name, picture)
       VALUES (@issuer, @subject, @email, @name, @picture)
       ON CONFLICT (issuer, subject) DO UPDATE SET
         email        = excluded.email,
         name         = excluded.name,
         picture      = excluded.picture,
         last_seen_at = datetime('now')
       RETURNING id`,
    )
    .get({
      issuer: claims.issuer,
      subject: claims.subject,
      email: claims.email ?? null,
      name: claims.name ?? null,
      picture: claims.picture ?? null,
    }) as { id: number }

  return row.id
}

/**
 * Returns how long a session may sit unused, in seconds.
 * @param {boolean} remember - Whether the longer window was asked for at login
 * @returns {number} - Idle window in seconds
 */
function windowSeconds(remember: boolean): number {
  const ms = remember ? config.session.rememberMaxAgeMs : config.session.maxAgeMs
  return Math.floor(ms / 1000)
}

/**
 * Opens a session for a user and returns the opaque id that identifies it.
 * @param {number} userId - User the session belongs to
 * @param {ReadonlyArray<string>} groups - Group claims to carry alongside it
 * @param {string | undefined} userAgent - Client that logged in, kept for the session list
 * @param {boolean} remember - Whether to use the longer idle window
 * @returns {string} - Session token to hand to the browser as a cookie, stored only as its digest
 */
export function createSession(
  userId: number,
  groups: ReadonlyArray<string>,
  userAgent?: string,
  remember = false,
): string {
  const token = randomBytes(SESSION_ID_BYTES).toString('base64url')

  getDb()
    .prepare(
      `INSERT INTO sessions (id, user_id, expires_at, user_agent, groups, remember, auth_mode)
       VALUES (?, ?, datetime('now', ?), ?, ?, ?, ?)`,
    )
    .run(
      sessionKey(token),
      userId,
      `+${windowSeconds(remember)} seconds`,
      userAgent ?? null,
      JSON.stringify(groups),
      remember ? 1 : 0,
      config.authMode,
    )

  return token
}

/**
 * Resolves a session id to the user it belongs to, ignoring sessions that have expired.
 * @param {string} id - Session id from the cookie
 * @returns {SessionUser | undefined} - The signed-in user, or undefined when the session is unknown or expired
 */
export function readSession(id: string): SessionUser | undefined {
  // The auth_mode check is what makes a session belong to the deployment that issued it.
  // Without it, moving a database from dev to local mode keeps the dev identity signed in as
  // an administrator, reachable by no password and revocable by no logout.
  const row = getDb()
    .prepare(
      `SELECT u.id, u.issuer, u.subject, u.email, u.name, u.picture, u.is_admin, s.groups
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ?
         AND s.expires_at > datetime('now')
         AND s.auth_mode = ?`,
    )
    .get(sessionKey(id), config.authMode) as SessionRow | undefined

  if (!row) {
    return undefined
  }

  return {
    id: row.id,
    issuer: row.issuer,
    subject: row.subject,
    email: row.email,
    name: row.name,
    picture: row.picture,
    isAdmin: row.is_admin === 1,
    groups: parseStringArray(row.groups),
  }
}

/**
 * Extends a session's life, so an account in daily use never has to log in again. Throttled,
 * because the portal is opened often enough that writing on every request would be pure cost.
 * @param {string} id - Session id to extend
 * @returns {void}
 */
export function touchSession(id: string): void {
  getDb()
    .prepare(
      `UPDATE sessions
       SET last_seen_at = datetime('now'),
           expires_at = datetime('now',
             CASE remember WHEN 1 THEN @remembered ELSE @default END)
       WHERE id = @id AND last_seen_at < datetime('now', @throttle)`,
    )
    .run({
      id: sessionKey(id),
      // Rolled by the window this session was opened with. Reading the current default here
      // instead would cut a remembered session back to a day on its next request.
      remembered: `+${windowSeconds(true)} seconds`,
      default: `+${windowSeconds(false)} seconds`,
      throttle: TOUCH_AFTER,
    })
}

/**
 * Ends a session, so the cookie that carried it stops working immediately.
 * @param {string} id - Session id to drop
 * @returns {void}
 */
export function deleteSession(id: string): void {
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sessionKey(id))
}

/**
 * Removes expired sessions, abandoned login handshakes and stale failed logins.
 * @returns {void}
 */
export function pruneExpired(): void {
  const db = getDb()
  db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run()
  db.prepare(`DELETE FROM auth_flows WHERE expires_at <= datetime('now')`).run()
  pruneAttempts()
}

/**
 * Ends a user's sessions, everywhere they were opened.
 *
 * This is what signing out everywhere runs, which is the only way a session opened on a device
 * no longer to hand is revoked: nothing evicts one on login, because an account is meant to be
 * signed in on a phone and a laptop at once.
 *
 * A password change has to call this too, once there is a route that performs one. Nothing
 * changes a password today, so there is no such call to find and copy: a session opened before
 * the change would otherwise outlive it by up to ninety days, which is the whole reason someone
 * changes a password in the first place.
 * @param {number} userId - User whose sessions should end
 * @param {string | undefined} keep - Session to spare, for a caller that stays signed in
 * @returns {void}
 */
export function deleteUserSessions(userId: number, keep?: string): void {
  getDb()
    .prepare('DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?')
    .run(userId, keep === undefined ? null : sessionKey(keep))
}
