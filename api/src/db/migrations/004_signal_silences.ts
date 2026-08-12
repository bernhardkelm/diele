import type { Migration } from '#db/migrate.js'

export const signalSilences: Migration = {
  id: 4,
  name: 'signal_silences',
  up(db) {
    // Shaped like hidden_entries, because it answers the same question about a different thing:
    // a null user_id is the portal's own choice and anything else is one person's.
    // `signal_id` is the id a source built from the alert's labels, so a silence follows the
    // condition rather than the row it happened to be drawn in.
    // No foreign key on it and nothing cascading: a signal is not a stored row, it exists only
    // while something is firing. What sweeps these is the read that finds the alert gone.
    db.exec(`
      CREATE TABLE signal_silences (
        signal_id  TEXT    NOT NULL,
        user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE UNIQUE INDEX idx_signal_silences ON signal_silences (signal_id, COALESCE(user_id, 0));
      CREATE INDEX idx_signal_silences_user ON signal_silences (user_id);
    `)
  },
}
