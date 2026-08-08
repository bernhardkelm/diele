import { CONFIG_CACHE_KEY, CONFIG_CACHE_MAX_AGE_MS } from '@/config/api'
import { readFreshEntry, removeStored, writeJson } from '@/helpers/storage'
import type { ApiConfig } from '@diele/common'

export interface ConfigCacheEntry {
  /** Epoch milliseconds the entry was written at, measured against the max age */
  readonly storedAt: number
  readonly config: ApiConfig
  /** Etag the payload came with, replayed as If-None-Match so an unchanged config costs a 304 */
  readonly etag?: string
}

/**
 * Reads the configuration left by an earlier visit, so the portal paints before the network
 * answers. The lists are checked rather than trusted: an entry written by an older build has
 * an older shape, and painting from it would fail further in where there is no way back.
 * @returns {ConfigCacheEntry | undefined} - Stored payload, or undefined when absent, unreadable or past its max age
 */
export function readConfigCache(): ConfigCacheEntry | undefined {
  const entry = readFreshEntry(CONFIG_CACHE_KEY, CONFIG_CACHE_MAX_AGE_MS)
  if (!entry) {
    return undefined
  }

  const config = entry.config as ApiConfig | undefined
  if (!config || !Array.isArray(config.cards) || !Array.isArray(config.sites)) {
    return undefined
  }

  if (!Array.isArray(config.engines)) {
    return undefined
  }

  return {
    storedAt: entry.storedAt as number,
    config,
    ...(typeof entry.etag === 'string' ? { etag: entry.etag } : {}),
  }
}

/**
 * Stores the configuration, so the next visit paints without waiting.
 * @param {ApiConfig} config - Payload to cache
 * @param {string | null} etag - Etag the response carried, when it had one
 * @returns {void}
 */
export function writeConfigCache(config: ApiConfig, etag: string | null): void {
  writeJson(CONFIG_CACHE_KEY, {
    storedAt: Date.now(),
    config,
    ...(etag ? { etag } : {}),
  })
}

/**
 * Drops the stored configuration, so the next read has to go to the API.
 * @returns {void}
 */
export function clearConfigCache(): void {
  removeStored(CONFIG_CACHE_KEY)
}
