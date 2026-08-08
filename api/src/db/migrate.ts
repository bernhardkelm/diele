import type { Database } from 'better-sqlite3'

export interface Migration {
  /** Sequential, starting at 1, and never reordered once committed */
  readonly id: number
  readonly name: string
  readonly up: (db: Database) => void
}

/**
 * Applies every migration the database has not seen yet, in id order, each in its own
 * transaction. `PRAGMA user_version` holds the highest applied id, which keeps the ledger in
 * the file itself and needs no bookkeeping table.
 * @param {Database} db - Open database to migrate
 * @param {ReadonlyArray<Migration>} migrations - Ordered migrations to apply
 * @returns {number} - The version the database is on afterwards
 */
export function migrate(db: Database, migrations: ReadonlyArray<Migration>): number {
  const ordered = [...migrations].sort((a, b) => a.id - b.id)

  ordered.forEach((migration, index) => {
    if (migration.id !== index + 1) {
      throw new Error(
        `migration ids must be sequential from 1: expected ${index + 1}, got ${migration.id} (${migration.name})`,
      )
    }
  })

  // A database migrated by a newer build carries columns and tables this one has no model of.
  // Every migration would read as already applied, so without this the process boots and runs
  // ordinary queries against a schema it does not know, which surfaces as unrelated SQL errors
  // rather than as the downgrade it is.
  const latest = ordered.at(-1)?.id ?? 0
  const found = db.pragma('user_version', { simple: true }) as number

  if (found > latest) {
    throw new Error(
      `the database is at version ${found}, which is newer than this build knows (${latest}). ` +
        `Run a build that carries migration ${found}, or restore a backup taken before the upgrade.`,
    )
  }

  for (const migration of ordered) {
    // The version is read inside the transaction, not once up front: two processes opening the
    // same file together would both read the old value and both run the migration, and the second
    // would fail on a table the first had already created. `immediate` takes the write lock at
    // BEGIN, so the second waits for the first to commit and then sees the version it set.
    const applied = db
      .transaction(() => {
        const current = db.pragma('user_version', { simple: true }) as number
        if (migration.id <= current) {
          return false
        }

        migration.up(db)
        // pragma cannot be parameterised, and the id is a number we validated above
        db.pragma(`user_version = ${migration.id}`)
        return true
      })
      .immediate()

    if (applied) {
      console.log(`migrated to ${migration.id} (${migration.name})`)
    }
  }

  return db.pragma('user_version', { simple: true }) as number
}
