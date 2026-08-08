import { Buffer } from 'node:buffer'
import { getDb } from '#db/index.js'
import { openSecret, sealSecret } from './crypto.js'

/** What a route may learn about a secret: that it exists, and when it was last written. */
export interface SecretStatus {
  readonly key: string
  readonly updatedAt: string
}

/**
 * One credential as it travels in an export: still sealed, never the value itself.
 *
 * Base64 rather than the raw buffers, because the document it rides in is JSON. What opens it
 * is the deployment's own encryption key, which is never in the file: an export read by an
 * instance configured with a different key carries nothing anyone can use.
 */
export interface TransferSecret {
  readonly key: string
  readonly keyId: string
  readonly iv: string
  readonly tag: string
  readonly ciphertext: string
}

// The AAD a travelling secret is bound to. A stored seal is bound to the connector row it
// belongs to, and an import gives every connector a new id, so a ciphertext copied straight out
// of the table would never open again on the other side. Connector ids come from an autoincrement
// that starts at 1, so this stands for "no row" and can never collide with one.
const TRANSFER_ID = 0

interface SecretRow {
  key: string
  ciphertext: Buffer
  iv: Buffer
  tag: Buffer
  key_id: string
  updated_at: string
}

/**
 * Stores or replaces one credential. An empty value deletes the row instead, so clearing a
 * field in the form is how a credential is removed.
 * @param {number} connectorId - Connector the credential belongs to
 * @param {string} key - Field name, as declared by the connector module
 * @param {string} plaintext - Credential as it was entered
 * @returns {void}
 */
export function writeSecret(connectorId: number, key: string, plaintext: string): void {
  if (plaintext.length === 0) {
    deleteSecret(connectorId, key)
    return
  }

  const sealed = sealSecret(plaintext, { connectorId, key })

  getDb()
    .prepare(
      `INSERT INTO connector_secrets (connector_id, key, ciphertext, iv, tag, key_id)
       VALUES (@connectorId, @key, @ciphertext, @iv, @tag, @keyId)
       ON CONFLICT (connector_id, key) DO UPDATE SET
         ciphertext = excluded.ciphertext,
         iv         = excluded.iv,
         tag        = excluded.tag,
         key_id     = excluded.key_id,
         updated_at = datetime('now')`,
    )
    .run({
      connectorId,
      key,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      tag: sealed.tag,
      keyId: sealed.keyId,
    })
}

/**
 * Decrypts every credential of one connector, for a sync that is about to use them. A row
 * that cannot be opened is left out with a warning rather than failing the whole read, so one
 * credential sealed with a retired key does not take the others down with it.
 * @param {number} connectorId - Connector being run
 * @returns {Record<string, string>} - Credentials by field name; an unset key is absent
 */
export function readSecrets(connectorId: number): Record<string, string> {
  const rows = getDb()
    .prepare(
      'SELECT key, ciphertext, iv, tag, key_id, updated_at FROM connector_secrets WHERE connector_id = ?',
    )
    .all(connectorId) as SecretRow[]

  const secrets: Record<string, string> = {}

  for (const row of rows) {
    try {
      secrets[row.key] = openSecret(
        { ciphertext: row.ciphertext, iv: row.iv, tag: row.tag, keyId: row.key_id },
        { connectorId, key: row.key },
      )
    } catch (cause) {
      console.warn(`[connectors] secret ${connectorId}/${row.key} could not be opened:`, cause)
    }
  }

  return secrets
}

/**
 * Lists which credentials a connector holds, without opening any of them. This is what a
 * route may answer with: the editor shows whether a secret is set, never its value.
 * @param {number} connectorId - Connector to describe
 * @returns {ReadonlyArray<SecretStatus>} - One entry per stored credential
 */
export function listSecretKeys(connectorId: number): ReadonlyArray<SecretStatus> {
  const rows = getDb()
    .prepare('SELECT key, updated_at FROM connector_secrets WHERE connector_id = ? ORDER BY key')
    .all(connectorId) as Array<{ key: string; updated_at: string }>

  return rows.map((row) => ({ key: row.key, updatedAt: row.updated_at }))
}

/**
 * Re-seals a connector's credentials for travel, so an export can carry them without ever
 * carrying their values.
 *
 * Opened and sealed again rather than copied: the stored seal is bound to the connector row it
 * sits in, and the import that reads this file gives every connector a new row. A credential
 * this deployment cannot open is left out, which is the same thing a sync does with it.
 * @param {number} connectorId - Connector whose credentials are being exported
 * @returns {ReadonlyArray<TransferSecret>} - One entry per credential that could be re-sealed
 */
export function exportSecrets(connectorId: number): ReadonlyArray<TransferSecret> {
  const plain = readSecrets(connectorId)

  return Object.entries(plain).map(([key, value]) => {
    const sealed = sealSecret(value, { connectorId: TRANSFER_ID, key })

    return {
      key,
      keyId: sealed.keyId,
      iv: sealed.iv.toString('base64'),
      tag: sealed.tag.toString('base64'),
      ciphertext: sealed.ciphertext.toString('base64'),
    }
  })
}

/**
 * Stores travelling credentials against the connector they were imported onto.
 *
 * A credential sealed with a key this deployment does not hold cannot be opened, so it is
 * dropped: the connector arrives without it and comes back switched off, which is what it would
 * do if the file had never carried one.
 * @param {number} connectorId - Connector the credentials now belong to
 * @param {ReadonlyArray<TransferSecret>} secrets - Credentials as the export carried them
 * @returns {number} - How many were opened and stored
 */
// @TODO: say so on the import screen when a credential is dropped, rather than only in the log
export function importSecrets(connectorId: number, secrets: ReadonlyArray<TransferSecret>): number {
  let stored = 0

  for (const secret of secrets) {
    try {
      const plaintext = openSecret(
        {
          ciphertext: Buffer.from(secret.ciphertext, 'base64'),
          iv: Buffer.from(secret.iv, 'base64'),
          tag: Buffer.from(secret.tag, 'base64'),
          keyId: secret.keyId,
        },
        { connectorId: TRANSFER_ID, key: secret.key },
      )

      writeSecret(connectorId, secret.key, plaintext)
      stored += 1
    } catch (cause) {
      console.warn(`[transfer] imported secret ${secret.key} could not be opened:`, cause)
    }
  }

  return stored
}

/**
 * Removes one credential.
 * @param {number} connectorId - Connector the credential belongs to
 * @param {string} key - Field name to clear
 * @returns {void}
 */
export function deleteSecret(connectorId: number, key: string): void {
  getDb()
    .prepare('DELETE FROM connector_secrets WHERE connector_id = ? AND key = ?')
    .run(connectorId, key)
}
