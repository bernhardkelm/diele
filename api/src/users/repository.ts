import { getDb } from '#db/index.js'
import { conflict } from '#errors.js'

// Local accounts share the users table with the ones an issuer vouched for, told apart by this
// value. It occupies the same `issuer` column, so the existing UNIQUE (issuer, subject) is what
// keeps usernames unique, and a local `alice` never collides with an issuer's `alice`.
export const LOCAL_ISSUER = 'local'

export interface LocalUserRecord {
  readonly id: number
  readonly username: string
  readonly name: string | null
  readonly passwordHash: string | null
  readonly isAdmin: boolean
}

export interface UserRecord {
  readonly id: number
  readonly issuer: string
  readonly username: string
  readonly name: string | null
  readonly email: string | null
  readonly isAdmin: boolean
}

interface LocalUserRow {
  id: number
  subject: string
  name: string | null
  password_hash: string | null
  is_admin: number
}

interface UserRow {
  id: number
  issuer: string
  subject: string
  name: string | null
  email: string | null
  is_admin: number
}

/**
 * Counts the accounts this portal holds itself, which is what decides whether the login screen
 * asks for a password or offers to create the first account.
 * @returns {number} - Number of local accounts
 */
export function countLocalUsers(): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS count FROM users WHERE issuer = ?')
    .get(LOCAL_ISSUER) as { count: number }

  return row.count
}

/**
 * Looks up a local account by its username.
 * @param {string} username - Normalised username
 * @returns {LocalUserRecord | undefined} - The account, or undefined when there is none
 */
export function findLocalUser(username: string): LocalUserRecord | undefined {
  const row = getDb()
    .prepare(
      `SELECT id, subject, name, password_hash, is_admin FROM users
       WHERE issuer = ? AND subject = ?`,
    )
    .get(LOCAL_ISSUER, username) as LocalUserRow | undefined

  if (!row) {
    return undefined
  }

  return {
    id: row.id,
    username: row.subject,
    name: row.name,
    passwordHash: row.password_hash,
    isAdmin: row.is_admin === 1,
  }
}

/**
 * Creates the first local account, as an administrator.
 *
 * The emptiness check is the INSERT's own WHERE clause rather than a read followed by a write,
 * so the database enforces "only ever one first account" instead of the control flow around it.
 * Checking first would still let two requests with *different* usernames both pass, which the
 * unique index on the username cannot catch either.
 * @param {{ username: string; name: string | null; passwordHash: string }} input - The account to create
 * @returns {number} - Id of the created user
 */
export function createInitialAdmin(input: {
  username: string
  name: string | null
  passwordHash: string
}): number {
  const db = getDb()

  // Immediate rather than deferred: a deferred transaction that reads before it writes is the
  // case WAL mode fails with SQLITE_BUSY_SNAPSHOT when a second connection is open.
  const create = db.transaction((): number => {
    const result = db
      .prepare(
        `INSERT INTO users (issuer, subject, name, password_hash, password_updated_at, is_admin)
         SELECT @issuer, @username, @name, @hash, datetime('now'), 1
         WHERE NOT EXISTS (SELECT 1 FROM users WHERE issuer = @issuer)`,
      )
      .run({
        issuer: LOCAL_ISSUER,
        username: input.username,
        name: input.name,
        hash: input.passwordHash,
      })

    if (result.changes !== 1) {
      throw conflict('this portal already has an account')
    }

    return Number(result.lastInsertRowid)
  })

  return create.immediate()
}

/**
 * Records that an account was just used, so the admin view can show it.
 * @param {number} id - User that signed in
 * @returns {void}
 */
export function markSignedIn(id: number): void {
  getDb().prepare(`UPDATE users SET last_seen_at = datetime('now') WHERE id = ?`).run(id)
}

/**
 * Lists every account the portal knows, for the admin view's count.
 * @returns {ReadonlyArray<UserRecord>} - Accounts, oldest first
 */
export function listUsers(): ReadonlyArray<UserRecord> {
  const rows = getDb()
    .prepare('SELECT id, issuer, subject, name, email, is_admin FROM users ORDER BY id')
    .all() as UserRow[]

  return rows.map((row) => ({
    id: row.id,
    issuer: row.issuer,
    username: row.subject,
    name: row.name,
    email: row.email,
    isAdmin: row.is_admin === 1,
  }))
}
