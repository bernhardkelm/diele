import type { Migration } from '#db/migrate.js'
import { seedStockConfig } from '#db/seed.js'

export const init: Migration = {
  id: 1,
  name: 'init',
  up(db) {
    // password_hash is nullable: an account that signs in through an issuer never has one, and
    // the column being empty is what tells the two kinds of account apart.
    // is_admin defaults to 1 so every issuer login keeps the access it has today; only
    // accounts created through the user editor start without it.
    db.exec(`
      CREATE TABLE users (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        issuer              TEXT    NOT NULL,
        subject             TEXT    NOT NULL,
        email               TEXT,
        name                TEXT,
        picture             TEXT,
        password_hash       TEXT,
        password_updated_at TEXT,
        is_admin            INTEGER NOT NULL DEFAULT 1,
        created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
        last_seen_at        TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE (issuer, subject)
      );
    `)

    // One account per username, enforced by the database rather than by remembering to
    // lowercase at every call site. Partial, so it only constrains local accounts and leaves
    // an issuer free to use whatever subject it likes.
    db.exec(`
      CREATE UNIQUE INDEX idx_users_local_username
      ON users (subject COLLATE NOCASE) WHERE issuer = 'local'
    `)

    // The id is a digest of the token rather than the token itself, so a copy of the file holds
    // nothing that can be presented as a session.
    // remember is carried on the row rather than derived at read time, so extending a session
    // picks the window it was opened with instead of shortening a remembered one to the
    // default. auth_mode ties a session to the mode that opened it, so a session left behind
    // by AUTH_MODE=dev cannot survive a switch to local.
    db.exec(`
      CREATE TABLE sessions (
        id           TEXT    PRIMARY KEY,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        last_seen_at TEXT    NOT NULL DEFAULT (datetime('now')),
        expires_at   TEXT    NOT NULL,
        user_agent   TEXT,
        groups       TEXT    NOT NULL DEFAULT '[]',
        remember     INTEGER NOT NULL DEFAULT 0,
        auth_mode    TEXT    NOT NULL DEFAULT ''
      );

      CREATE INDEX idx_sessions_user    ON sessions (user_id);
      CREATE INDEX idx_sessions_expires ON sessions (expires_at);
    `)

    // The flow row carries `remember` too, because the choice is made before the trip to the
    // issuer and has to survive it. The nonce is checked against the id token on the way back.
    db.exec(`
      CREATE TABLE auth_flows (
        state         TEXT PRIMARY KEY,
        code_verifier TEXT NOT NULL,
        nonce         TEXT NOT NULL DEFAULT '',
        redirect_to   TEXT,
        remember      INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at    TEXT NOT NULL
      );
    `)

    // In the database rather than in memory, so restarting the process does not clear a
    // lockout, which would make the limit worth nothing to anyone able to cause a restart.
    db.exec(`
      CREATE TABLE login_attempts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        username   TEXT    NOT NULL,
        ip         TEXT    NOT NULL,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_login_attempts_username ON login_attempts (username, created_at);
      CREATE INDEX idx_login_attempts_ip       ON login_attempts (ip, created_at);
    `)

    db.exec(`
      CREATE TABLE icons (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL,
        svg        TEXT    NOT NULL,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );
    `)

    // Cards and saved sites differ only in where they render, so they share one table and are
    // told apart by `kind`.
    db.exec(`
      CREATE TABLE links (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        kind       TEXT    NOT NULL CHECK (kind IN ('card', 'site')),
        label      TEXT    NOT NULL,
        url        TEXT    NOT NULL,
        display    TEXT,
        keywords   TEXT    NOT NULL DEFAULT '[]',
        icon_id    INTEGER REFERENCES icons(id) ON DELETE SET NULL,
        color      TEXT,
        position   INTEGER NOT NULL,
        enabled    INTEGER NOT NULL DEFAULT 1,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_links_kind_position ON links (kind, position);
    `)

    db.exec(`
      CREATE TABLE search_engines (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT    NOT NULL,
        url_template TEXT    NOT NULL,
        position     INTEGER NOT NULL,
        enabled      INTEGER NOT NULL DEFAULT 1,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_search_engines_position ON search_engines (position);
    `)

    // Deliberately not rows in `links`: a saved site is a destination someone typed, while
    // these are ports the frontend probes on every load. Only the scheme and the port are
    // editable, because everything else about them is derived.
    db.exec(`
      CREATE TABLE localhost_ports (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        scheme     TEXT    NOT NULL DEFAULT 'http' CHECK (scheme IN ('http', 'https')),
        port       INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
        keywords   TEXT    NOT NULL DEFAULT '[]',
        position   INTEGER NOT NULL,
        enabled    INTEGER NOT NULL DEFAULT 1,
        created_at TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE (scheme, port)
      );

      CREATE INDEX idx_localhost_position ON localhost_ports (position);
    `)

    // A shorthand plus a query template: `/yt cats` reaches youtube without the term ever
    // touching the default engine. The built-in `/admin` and `/settings` are not rows here,
    // because they navigate rather than search and nothing about them is configurable.
    db.exec(`
      CREATE TABLE slash_commands (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        keyword      TEXT    NOT NULL UNIQUE,
        label        TEXT,
        url_template TEXT    NOT NULL,
        position     INTEGER NOT NULL,
        enabled      INTEGER NOT NULL DEFAULT 1,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX idx_slash_commands_position ON slash_commands (position);
    `)

    db.exec(`
      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `)

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

    // Here rather than in a migration of its own, because this one carries the guarantee the
    // seed needs: it runs only where there was no database a moment ago. A later migration
    // would run on every install and put back rows someone had deliberately deleted.
    seedStockConfig(db)
  },
}
