import type { Migration } from '#db/migrate.js'

export const init: Migration = {
  id: 1,
  name: 'init',
  up(db) {
    // `owner` is the account's `users.history_key`, never its id: this file is restored apart
    // from the configuration, and an id handed out again would hand the rows to someone else.
    // The users table lives in the other file, so there is no foreign key to declare and nothing
    // cascades; the prune sweeps every owner whose key no account holds any more.
    // `title_hashes` holds digests of the distinct titles the url arrived with, up to the count
    // that marks it as a shell page, so the titles of whatever its query pointed at are not kept.
    db.exec(`
      CREATE TABLE history_entries (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        owner            TEXT    NOT NULL,
        url              TEXT    NOT NULL,
        title            TEXT,
        title_hashes     TEXT    NOT NULL DEFAULT '[]',
        visit_count      INTEGER NOT NULL DEFAULT 1,
        first_visited_at TEXT    NOT NULL,
        last_visited_at  TEXT    NOT NULL,
        UNIQUE (owner, url)
      );

      CREATE INDEX idx_history_entries_recent ON history_entries (owner, last_visited_at);
    `)

    // A url whose content follows its query string, folded into its origin. Kept apart from the
    // entries so the fold outlives the entry it replaced, and the next visit lands on the origin
    // straight away rather than counting titles all over again.
    db.exec(`
      CREATE TABLE history_shells (
        owner TEXT NOT NULL,
        url   TEXT NOT NULL,
        PRIMARY KEY (owner, url)
      );
    `)

    // `forget_epoch` moves on every delete the account asks for, so a probe that started before
    // one cannot write back what was just forgotten.
    db.exec(`
      CREATE TABLE history_preferences (
        owner            TEXT    PRIMARY KEY,
        enabled          INTEGER NOT NULL DEFAULT 0,
        excluded_domains TEXT    NOT NULL DEFAULT '[]',
        forget_epoch     INTEGER NOT NULL DEFAULT 0,
        updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
      );
    `)
  },
}
