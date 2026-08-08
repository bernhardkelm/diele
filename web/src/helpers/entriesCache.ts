import { ENTRIES_CACHE_KEY, ENTRIES_CACHE_MAX_AGE_MS } from '@/config/api'
import { readFreshEntry, removeStored, writeJson } from '@/helpers/storage'
import type { ApiEntries } from '@diele/common'

export interface EntriesCacheEntry {
  /** Epoch milliseconds the entry was written at, measured against the max age */
  readonly storedAt: number
  readonly payload: ApiEntries
  readonly etag?: string
}

/**
 * Fills in the parts of a payload that may be missing, so every reader downstream can index into
 * it without checking first. A cache written by an older build and a proxy answering with
 * something unexpected arrive the same way here, and either would otherwise throw inside a
 * computed while the page is rendering.
 * @param {unknown} raw - Payload as read from the network or from storage
 * @returns {ApiEntries | undefined} - The payload, or undefined when it is not one at all
 */
export function toEntriesPayload(raw: unknown): ApiEntries | undefined {
  const payload = raw as ApiEntries | undefined
  if (!payload || !Array.isArray(payload.entries)) {
    return undefined
  }

  const hidden = payload.hidden as ApiEntries['hidden'] | undefined

  return {
    entries: payload.entries.map((entry) => ({
      ...entry,
      keywords: Array.isArray(entry?.keywords) ? entry.keywords : [],
      actions: Array.isArray(entry?.actions) ? entry.actions : [],
    })),
    sources: Array.isArray(payload.sources) ? payload.sources : [],
    hidden: {
      all: Array.isArray(hidden?.all) ? hidden.all : [],
      mine: Array.isArray(hidden?.mine) ? hidden.mine : [],
    },
  }
}

/**
 * Reads the connector entries left by an earlier visit. The API caches them too, so this is
 * the second tier: it saves the round trip, not the sync.
 * @returns {EntriesCacheEntry | undefined} - Stored payload, or undefined when absent, unreadable or past its max age
 */
export function readEntriesCache(): EntriesCacheEntry | undefined {
  const entry = readFreshEntry(ENTRIES_CACHE_KEY, ENTRIES_CACHE_MAX_AGE_MS)
  const payload = toEntriesPayload(entry?.payload)
  if (!entry || !payload) {
    return undefined
  }

  return {
    storedAt: entry.storedAt as number,
    payload,
    ...(typeof entry.etag === 'string' ? { etag: entry.etag } : {}),
  }
}

/**
 * Stores the entries, so the next visit paints before the network answers.
 * @param {ApiEntries} payload - Payload to cache
 * @param {string | null} etag - Validator the next request revalidates with
 * @returns {void}
 */
export function writeEntriesCache(payload: ApiEntries, etag: string | null): void {
  writeJson(ENTRIES_CACHE_KEY, {
    storedAt: Date.now(),
    payload,
    ...(etag ? { etag } : {}),
  })
}

/**
 * Drops the stored entries. These name a person's repositories and groups, so they leave the
 * browser with the session rather than waiting for their max age to pass.
 * @returns {void}
 */
export function clearEntriesCache(): void {
  removeStored(ENTRIES_CACHE_KEY)
}
