import type { Migration } from '#db/migrate.js'

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
    // issuer and has to survive it.
    db.exec(`
      CREATE TABLE auth_flows (
        state         TEXT PRIMARY KEY,
        code_verifier TEXT NOT NULL,
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
  },
}
