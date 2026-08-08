import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { config } from '#config.js'

const ALGORITHM = 'aes-256-gcm'

// 96 bits is what gcm is specified for; anything else makes node derive one internally and
// costs the guarantee that two seals never share a counter.
const IV_BYTES = 12

export interface SealedSecret {
  readonly ciphertext: Buffer
  readonly iv: Buffer
  readonly tag: Buffer
  readonly keyId: string
}

/** Names what a row belongs to, so ciphertext moved between rows fails to open. */
export interface SecretScope {
  readonly connectorId: number
  readonly key: string
}

/**
 * Returns the additional data a seal is bound to, which is what stops a ciphertext being
 * copied from one connector's token onto another's.
 * @param {SecretScope} scope - Row the secret belongs to
 * @returns {Buffer} - Associated data for the cipher
 */
function aadFor(scope: SecretScope): Buffer {
  return Buffer.from(`${scope.connectorId}:${scope.key}`, 'utf8')
}

/**
 * Encrypts a credential with the active key.
 * @param {string} plaintext - Credential as it was entered
 * @param {SecretScope} scope - Row it is being stored under
 * @returns {SealedSecret} - Ciphertext with the iv, tag and key it was sealed with
 */
export function sealSecret(plaintext: string, scope: SecretScope): SealedSecret {
  const { activeKeyId, keys } = config.secrets
  const key = keys.get(activeKeyId)
  if (!key) {
    throw new Error('no encryption key is configured, so a credential cannot be stored')
  }

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  cipher.setAAD(aadFor(scope))

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return { ciphertext, iv, tag: cipher.getAuthTag(), keyId: activeKeyId }
}

/**
 * Decrypts a stored credential. Throws when the key that sealed it is gone or the ciphertext
 * has been altered, because returning something wrong would surface later as an integration
 * that fails for no visible reason.
 * @param {SealedSecret} sealed - Row as it was stored
 * @param {SecretScope} scope - Row it was stored under
 * @returns {string} - The credential
 */
export function openSecret(sealed: SealedSecret, scope: SecretScope): string {
  const key = config.secrets.keys.get(sealed.keyId)
  if (!key) {
    throw new Error(`secret was sealed with key "${sealed.keyId}", which is not configured`)
  }

  const decipher = createDecipheriv(ALGORITHM, key, sealed.iv)
  decipher.setAAD(aadFor(scope))
  decipher.setAuthTag(sealed.tag)

  return Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]).toString('utf8')
}
