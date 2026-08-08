import { Buffer } from 'node:buffer'

/** AES-256, so nothing shorter than 32 bytes is a key at all. */
const KEY_BYTES = 32

export interface SecretKeyring {
  /** Which key new ciphertext is sealed with; empty when the ring holds none */
  readonly activeKeyId: string
  readonly keys: ReadonlyMap<string, Buffer>
  /** False when nothing usable was configured, which is what makes connectors degrade */
  readonly available: boolean
}

const EMPTY: SecretKeyring = { activeKeyId: '', keys: new Map(), available: false }

/**
 * Parses the keyring out of its environment variable. The format is a comma separated list of
 * `id:base64` pairs and the first entry is the active one, so rotating means prepending a new
 * key and leaving the old ones behind to open what they sealed.
 *
 * A malformed or absent value yields an empty ring rather than throwing: the portal is the
 * only gate in front of itself, and refusing to boot over a connector credential would take
 * the login screen down with it.
 * @param {string | undefined} raw - Value of DIELE_SECRET_KEYS
 * @returns {SecretKeyring} - Parsed keys, empty when none are usable
 */
export function parseKeyring(raw: string | undefined): SecretKeyring {
  const trimmed = raw?.trim()
  if (!trimmed) {
    return EMPTY
  }

  const keys = new Map<string, Buffer>()
  let activeKeyId = ''

  for (const entry of trimmed.split(',')) {
    const pair = entry.trim()
    if (pair.length === 0) {
      continue
    }

    const separator = pair.indexOf(':')
    if (separator <= 0) {
      console.warn(`DIELE_SECRET_KEYS entry "${redact(pair)}" is not id:base64, skipping it`)
      continue
    }

    const id = pair.slice(0, separator).trim()
    const material = Buffer.from(pair.slice(separator + 1).trim(), 'base64')

    if (material.length !== KEY_BYTES) {
      console.warn(
        `DIELE_SECRET_KEYS key "${id}" is ${material.length} bytes, not ${KEY_BYTES}, skipping it`,
      )
      continue
    }

    if (keys.has(id)) {
      console.warn(`DIELE_SECRET_KEYS names "${id}" twice, keeping the first`)
      continue
    }

    keys.set(id, material)
    if (activeKeyId === '') {
      activeKeyId = id
    }
  }

  if (keys.size === 0) {
    console.warn('DIELE_SECRET_KEYS holds no usable key, so connectors cannot store credentials')
    return EMPTY
  }

  return { activeKeyId, keys, available: true }
}

/**
 * Reduces a malformed entry to its identifier, so a warning about it cannot print key
 * material into the log.
 * @param {string} entry - Raw entry as written in the variable
 * @returns {string} - The part before the first colon, or a placeholder
 */
function redact(entry: string): string {
  const separator = entry.indexOf(':')

  return separator > 0 ? entry.slice(0, separator) : '(unnamed)'
}
