import type { Migration } from '#db/migrate.js'

export const sessionIdToken: Migration = {
  id: 2,
  name: 'session_id_token',
  up(db) {
    // The token the issuer vouched with, kept so signing out can present it back as
    // `id_token_hint`. Without one an issuer asks the person to confirm the logout on a page of
    // its own and never honours the return trip. Nullable: only an oidc session has one, and it
    // goes with the row when the session ends.
    db.exec(`ALTER TABLE sessions ADD COLUMN id_token TEXT`)
  },
}
