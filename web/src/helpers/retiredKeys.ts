import { RETIRED_STORAGE_KEYS } from '@/config/api'
import { removeStored } from '@/helpers/storage'

/**
 * Drops what an older build stored and nothing reads any more. Run on every load rather than once,
 * because a removal that finds nothing costs nothing and needs no marker of its own to remember it.
 * @returns {void}
 */
export function dropRetiredKeys(): void {
  for (const key of RETIRED_STORAGE_KEYS) {
    removeStored(key)
  }
}
