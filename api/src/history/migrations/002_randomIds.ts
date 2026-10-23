import type { Migration } from '#db/migrate.js'
import { randomEntryId } from '#history/entryIds.js'

interface EntryRow {
  owner: string
  url: string
  title: string | null
  title_hashes: string
  visit_count: number
  first_visited_at: string
  last_visited_at: string
}

export const randomIds: Migration = {
  id: 2,
  name: 'random entry ids and last source',
  up(db) {
    // Rebuilt rather than altered: the ids the counter handed out say how many entries the
    // instance created, so every row gets a random one, and without AUTOINCREMENT `sqlite_sequence`
    // keeps no high-water mark either. `last_source` is the source of the visit last counted and
    // not yet paired, so the same load reported by the portal and the extension counts once.
    db.exec(`
      CREATE TABLE history_entries_next (
        id               INTEGER PRIMARY KEY,
        owner            TEXT    NOT NULL,
        url              TEXT    NOT NULL,
        title            TEXT,
        title_hashes     TEXT    NOT NULL DEFAULT '[]',
        visit_count      INTEGER NOT NULL DEFAULT 1,
        first_visited_at TEXT    NOT NULL,
        last_visited_at  TEXT    NOT NULL,
        last_source      TEXT,
        UNIQUE (owner, url)
      );
    `)

    const rows = db
      .prepare(
        `SELECT owner, url, title, title_hashes, visit_count, first_visited_at, last_visited_at
         FROM history_entries`,
      )
      .all() as EntryRow[]
    const insert = db.prepare(
      `INSERT INTO history_entries_next
         (id, owner, url, title, title_hashes, visit_count, first_visited_at, last_visited_at)
       VALUES
         (@id, @owner, @url, @title, @title_hashes, @visit_count, @first_visited_at, @last_visited_at)`,
    )
    const taken = new Set<number>()

    for (const row of rows) {
      let id = randomEntryId()
      while (taken.has(id)) {
        id = randomEntryId()
      }

      taken.add(id)
      insert.run({ ...row, id })
    }

    db.exec(`
      DROP TABLE history_entries;
      ALTER TABLE history_entries_next RENAME TO history_entries;
      CREATE INDEX idx_history_entries_recent ON history_entries (owner, last_visited_at);
    `)
  },
}
