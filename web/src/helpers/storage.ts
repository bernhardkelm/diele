// Everything the portal stores locally is a convenience: a theme it can fall back from, a
// cache it can refetch, a list it can rebuild. localStorage throws rather than degrading when
// it is disabled, full, or running in a private window, so every access here swallows that and
// answers as though nothing had been stored. A failure then costs the convenience and never
// the page.

/**
 * Reads a raw stored string.
 * @param {string} key - Storage key
 * @returns {string | null} - Stored value, or null when absent or unreadable
 */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * Stores a raw string.
 * @param {string} key - Storage key
 * @param {string} value - Value to store
 * @returns {void}
 */
export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // see readStored
  }
}

/**
 * Drops a stored value.
 * @param {string} key - Storage key
 * @returns {void}
 */
export function removeStored(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // see readStored
  }
}

/**
 * Reads and parses a stored json value. Unparseable content reads as absent, because a half
 * written or older-shaped entry is worth no more than none at all.
 * @param {string} key - Storage key
 * @returns {unknown} - Parsed value, or undefined when absent or unreadable
 */
function readJson(key: string): unknown {
  const raw = readStored(key)
  if (raw === null) {
    return undefined
  }

  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

/**
 * Serialises a value and stores it.
 * @param {string} key - Storage key
 * @param {unknown} value - Value to serialise
 * @returns {void}
 */
export function writeJson(key: string, value: unknown): void {
  try {
    writeStored(key, JSON.stringify(value))
  } catch {
    // a value that cannot be serialised is a bug rather than a storage failure, but it still
    // must not reach the caller: nothing here is worth interrupting a render for
  }
}

/**
 * Reads an entry that stamps itself with `storedAt`, dropping it once it is past its max age.
 * Whatever the entry carries beyond the stamp is the caller's to validate, because only the
 * caller knows what shape it wrote.
 * @param {string} key - Storage key
 * @param {number} maxAgeMs - How long an entry stays worth reading
 * @returns {Record<string, unknown> | undefined} - The entry, or undefined when absent, unreadable or stale
 */
export function readFreshEntry(key: string, maxAgeMs: number): Record<string, unknown> | undefined {
  const parsed = readJson(key)
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined
  }

  const entry = parsed as Record<string, unknown>
  if (typeof entry.storedAt !== 'number' || Date.now() - entry.storedAt > maxAgeMs) {
    return undefined
  }

  return entry
}

/**
 * Reads a stored list of strings, dropping anything in it that is not one. Callers cap it
 * themselves, because which end to keep is the caller's decision rather than storage's.
 * @param {string} key - Storage key
 * @returns {string[]} - Stored strings, empty when absent or unreadable
 */
export function readStringList(key: string): string[] {
  const parsed = readJson(key)
  if (!Array.isArray(parsed)) {
    return []
  }

  return parsed.filter((entry): entry is string => typeof entry === 'string')
}
