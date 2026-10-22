import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { config } from '#config.js'
import type { DB } from '#db/index.js'
import { migrate } from '#db/migrate.js'
import { init } from './migrations/001_init.js'
import { randomIds } from './migrations/002_randomIds.js'

const MIGRATIONS = [init, randomIds]

let db: DB | null = null

/**
 * Opens the history database on first call, creating and migrating it as needed, then hands the
 * same connection to every later caller. Only what records something calls this: a deployment
 * that never turns history on never gets the file.
 * @returns {DB} - Open, migrated history database
 */
export function getHistoryDb(): DB {
  if (db) {
    return db
  }

  const path = config.history.dbPath
  const dir = dirname(path)
  if (dir && dir !== '.') {
    mkdirSync(dir, { recursive: true })
  }

  // Created readable by this user alone before sqlite opens it, because sqlite gives the `-wal`
  // and `-shm` files the mode of the database and would otherwise create it under the umask.
  if (!existsSync(path)) {
    closeSync(openSync(path, 'wx', 0o600))
  }

  const database = new Database(path)
  database.pragma('journal_mode = WAL')
  // A deleted row is overwritten rather than left in a free page, so forgetting a page means the
  // file no longer holds it.
  database.pragma('secure_delete = ON')
  migrate(database, MIGRATIONS)

  db = database
  return database
}

/**
 * Returns the history database when it exists, without creating it. What only reads or removes
 * has nothing to do on a deployment that never recorded anything, and should leave no file behind.
 * @returns {DB | undefined} - Open database, or undefined when there is no file yet
 */
export function peekHistoryDb(): DB | undefined {
  if (db) {
    return db
  }

  return existsSync(config.history.dbPath) ? getHistoryDb() : undefined
}

/**
 * Folds the write-ahead log back into the file and empties it, after a delete someone asked for.
 * Until then the log still holds the rows that were just removed.
 * @returns {void}
 */
export function checkpointHistory(): void {
  db?.pragma('wal_checkpoint(TRUNCATE)')
}

/**
 * Closes the history database, so the next caller opens and migrates a fresh connection.
 * @returns {void}
 */
export function closeHistoryDb(): void {
  db?.close()
  db = null
}
