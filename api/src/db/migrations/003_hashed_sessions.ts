import type { Migration } from '#db/migrate.js'

export const hashedSessions: Migration = {
  id: 3,
  name: 'hashed_sessions',
  up(db) {
    // Sessions are stored as a digest of the token from here on, so rows written before this hold
    // a value the lookup can no longer produce and would never match again. Dropping them also
    // retires the bearers themselves, which is the point: any copy of the file taken while they
    // were stored raw carried working sessions, and leaving them live would keep that true.
    // The cost is one sign-in.
    db.exec('DELETE FROM sessions;')
  },
}
