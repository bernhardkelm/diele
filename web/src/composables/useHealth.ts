import { polledJson } from '@/composables/usePolledJson'
import { HEALTH_URL } from '@/config/api'
import type { ApiHealth, ApiHealthReading } from '@diele/common'

const EMPTY: Record<string, ApiHealthReading> = {}

export interface HealthSource {
  /** How an entry last answered; undefined for one unbound, or whose source is switched off or gone */
  readingFor: (ref: string) => ApiHealthReading | undefined
}

// Shared at module scope the way the config and the entries are: the readings are one document,
// and the card grid and the site list asking for them must not mean two polls.
const readings = polledJson<Record<string, ApiHealthReading>, ApiHealth>({
  url: HEALTH_URL,
  empty: EMPTY,
  select: (payload) => payload.readings ?? EMPTY,
  whenUnavailable: 'liveness unavailable, keeping the last readings',
})

/**
 * Tracks how each bound card and saved site last answered. Polled rather than pushed, and idle
 * while the tab is in the background: a new tab page spends most of its life behind another one,
 * and polling into it would be load nobody can see the result of.
 * @param {() => boolean} enabled - Whether the view reading these is on screen at all
 * @returns {HealthSource} - Reactive readings by ref
 */
export function useHealth(enabled: () => boolean = () => true): HealthSource {
  readings.read(enabled)

  return { readingFor: (ref: string) => readings.data.value[ref] }
}

/**
 * Drops everything held, so the next reader starts from nothing.
 * @returns {void}
 */
export function resetHealth(): void {
  readings.reset()
}
