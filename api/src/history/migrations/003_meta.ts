import type { Migration } from '#db/migrate.js'

export const meta: Migration = {
  id: 3,
  name: 'meta',
  up(db) {
    // What the history file has to remember about itself across restarts, such as since when no
    // account has held any of its owners' keys. Never anything about an account.
    db.exec(`
      CREATE TABLE history_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)
  },
}
