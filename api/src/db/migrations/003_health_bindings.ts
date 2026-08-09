import type { Migration } from '#db/migrate.js'

export const healthBindings: Migration = {
  id: 3,
  name: 'health_bindings',
  up(db) {
    // Keyed by ref rather than by anything one feature owns, the way hidden_entries is: the same
    // table binds a card, a saved site and a connector-produced row, and a decorator added later
    // needs no table of its own.
    // `ref` carries no foreign key because it names rows of several tables at once. A connector
    // going away takes its bindings with it through connector_id; a link going away is swept by
    // the route that deleted it.
    // Primary key on the ref alone, so an entry has one provider and never two. A second binding
    // would mean deciding which of two states a single dot draws, which is a rule nobody asked
    // for and every reader would have to learn.
    // connector_id is null exactly when provider is 'http', which is the built-in probe and has
    // no instance behind it.
    db.exec(`
      CREATE TABLE health_bindings (
        ref          TEXT    NOT NULL PRIMARY KEY,
        provider     TEXT    NOT NULL,
        connector_id INTEGER REFERENCES connectors(id) ON DELETE CASCADE,
        selector     TEXT,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_health_bindings_connector ON health_bindings (connector_id);
    `)
  },
}
