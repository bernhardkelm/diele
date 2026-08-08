import type { Migration } from '#db/migrate.js'

export const flowNonce: Migration = {
  id: 4,
  name: 'flow_nonce',
  up(db) {
    // Handshakes in flight were started without a nonce, so the callback would check one the id
    // token cannot carry. They last ten minutes and only exist between a redirect and its return,
    // so dropping them costs whoever is mid-login one retry.
    db.exec(`
      DELETE FROM auth_flows;

      ALTER TABLE auth_flows ADD COLUMN nonce TEXT NOT NULL DEFAULT '';
    `)
  },
}
