import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { config } from '#config.js'
import { migrate } from './migrate.js'
import { init } from './migrations/001_init.js'
import { sessionIdToken } from './migrations/002_session_id_token.js'

export type DB = Database.Database

// A fresh database starts empty on purpose: configuration is entered through the API, and
// seeding it here would mean a portal that shows rows nobody added.
const MIGRATIONS = [init, sessionIdToken]

let db: DB | null = null

/**
 * Opens the database on first call and migrates it up to the latest version, then hands the
 * same connection to every later caller.
 * @returns {DB} - Open, migrated database
 */
export function getDb(): DB {
  if (db) {
    return db
  }

  const dir = dirname(config.dbPath)
  if (dir && dir !== '.') {
    mkdirSync(dir, { recursive: true })
  }

  const database = new Database(config.dbPath)
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  migrate(database, MIGRATIONS)

  db = database
  return database
}

/**
 * Closes the database, so the next caller opens and migrates a fresh connection.
 * @returns {void}
 */
export function closeDb(): void {
  db?.close()
  db = null
}
