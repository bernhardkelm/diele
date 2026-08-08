import type { Migration } from '#db/migrate.js'

export const connectors: Migration = {
  id: 2,
  name: 'connectors',
  up(db) {
    // user_id is unused today and always null: a connector is the portal's, the way the nginx
    // proxy it replaces was. It is declared here so the per-user variant is a code change
    // rather than a table rebuild.
    // No CHECK on `type`: renaming a CHECK in sqlite means rebuilding the table, and adding a
    // connector must never cost that. src/connectors/registry.ts is the allowlist, enforced at
    // the route.
    db.exec(`
      CREATE TABLE connectors (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        type            TEXT    NOT NULL,
        label           TEXT    NOT NULL,
        user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
        config          TEXT    NOT NULL DEFAULT '{}',
        sync_interval_s INTEGER NOT NULL DEFAULT 900,
        position        INTEGER NOT NULL,
        enabled         INTEGER NOT NULL DEFAULT 1,
        created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_connectors_type_position ON connectors (type, position);
    `)

    // iv and tag are their own columns rather than packed into the ciphertext, which is the
    // shape node:crypto's gcm api hands back and asks for. key_id names which key sealed the
    // row, and is the only thing that makes rotation possible without re-entering everything.
    db.exec(`
      CREATE TABLE connector_secrets (
        connector_id INTEGER NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
        key          TEXT    NOT NULL,
        ciphertext   BLOB    NOT NULL,
        iv           BLOB    NOT NULL,
        tag          BLOB    NOT NULL,
        key_id       TEXT    NOT NULL,
        updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (connector_id, key)
      );
    `)

    // The sync cache, persisted rather than held in memory: the process restarts on every
    // deploy and every drain, and a portal whose repo list is empty until GitLab answers is
    // the failure this whole arrangement exists to avoid.
    // No `position`: these are ordered by their source rather than dragged, so sort_key is a
    // column instead of a comparator the client had to learn.
    db.exec(`
      CREATE TABLE connector_entries (
        connector_id INTEGER NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
        ref          TEXT    NOT NULL,
        kind         TEXT    NOT NULL CHECK (kind IN ('card','row','suggestion','engine','inline')),
        label        TEXT    NOT NULL,
        detail       TEXT,
        url          TEXT    NOT NULL,
        keywords     TEXT    NOT NULL DEFAULT '[]',
        actions      TEXT    NOT NULL DEFAULT '[]',
        sort_key     TEXT    NOT NULL DEFAULT '',
        timestamp    TEXT,
        parent_ref   TEXT,
        search_only  INTEGER NOT NULL DEFAULT 0,
        health_ref   TEXT,
        synced_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (connector_id, ref)
      );

      CREATE UNIQUE INDEX idx_connector_entries_ref  ON connector_entries (ref);
      CREATE INDEX        idx_connector_entries_sort ON connector_entries (connector_id, sort_key);
    `)

    // next_run_at makes the scheduler one query rather than one timer per connector, and
    // running_since is what a second tick reads before starting a run that is already going.
    db.exec(`
      CREATE TABLE connector_sync (
        connector_id  INTEGER PRIMARY KEY REFERENCES connectors(id) ON DELETE CASCADE,
        last_run_at   TEXT,
        last_ok_at    TEXT,
        last_error    TEXT,
        entry_count   INTEGER NOT NULL DEFAULT 0,
        failures      INTEGER NOT NULL DEFAULT 0,
        running_since TEXT,
        next_run_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        cursor        TEXT
      );

      CREATE INDEX idx_connector_sync_due ON connector_sync (next_run_at);
    `)

    // Keyed by ref rather than by anything a connector owns, so the same table hides a repo, a
    // card and whatever a later connector produces.
    // A null user_id is the portal's own choice, made by an admin and applying to everyone; a
    // set one is that person's. Both kinds live here rather than one of them in the browser:
    // a preference that only exists on the device that made it is one someone loses by opening
    // the portal somewhere else.
    // The unique index folds the null down to 0, because sqlite treats nulls as distinct and a
    // plain UNIQUE would let the same ref be hidden for everyone twice over.
    db.exec(`
      CREATE TABLE hidden_entries (
        ref        TEXT    NOT NULL,
        user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE UNIQUE INDEX idx_hidden_entries ON hidden_entries (ref, COALESCE(user_id, 0));
      CREATE INDEX idx_hidden_entries_user ON hidden_entries (user_id);
    `)
  },
}
