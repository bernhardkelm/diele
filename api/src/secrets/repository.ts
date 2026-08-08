import { Buffer } from 'node:buffer'
import { getDb } from '#db/index.js'
import { openSecret, sealSecret } from './crypto.js'

/** What a route may learn about a secret: that it exists, and when it was last written. */
export interface SecretStatus {
  readonly key: string
  readonly updatedAt: string
}

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
