import type { Migration } from '#db/migrate.js'

export const historyKey: Migration = {
  id: 5,
  name: 'history_key',
  up(db) {
    // What the history database files an account's rows under, rather than `users.id`. That file
    // is backed up and restored apart from this one, and an id handed out again after a reset
    // would otherwise give a new account somebody else's history. Random, and only created once
    // the account first touches history, so an account that never does carries none.
    db.exec(`
      ALTER TABLE users ADD COLUMN history_key TEXT;

      CREATE UNIQUE INDEX idx_users_history_key ON users (history_key)
        WHERE history_key IS NOT NULL;
    `)
  },
}
