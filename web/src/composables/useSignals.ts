import { computed, type ComputedRef } from 'vue'
import { polledJson } from '@/composables/usePolledJson'
import { SIGNALS_SILENCE_URL, SIGNALS_URL } from '@/config/api'
import type { ApiSignal, ApiSignals } from '@diele/common'

const EMPTY: ReadonlyArray<ApiSignal> = []

export interface SignalSource {
  /** What is firing, worst first; empty while nothing is, or the feature is off */
  signals: ComputedRef<ReadonlyArray<ApiSignal>>
  /**
   * Quietens one alert for this portal, never in the source: an admin takes it off the page for
   * everyone and anyone else takes it off their own. It comes back on its own if the condition
   * clears and fires again.
   */
  silence: (id: string) => Promise<void>
}

// Shared at module scope the way the readings are: one document, however many components read it.
const firing = polledJson<ReadonlyArray<ApiSignal>, ApiSignals>({
  url: SIGNALS_URL,
  empty: EMPTY,
  select: (payload) => payload.signals ?? EMPTY,
  whenUnavailable: 'alerts unavailable, keeping the last answer',
})

/**
 * Tracks what the connected sources report as firing. Polled and idle in the background, like
 * the readings, and gated by the caller so a portal with the feature switched off never asks.
 * @param {() => boolean} enabled - Whether the view reading these is on screen and wants them
 * @returns {SignalSource} - Reactive list of what is firing
 */
export function useSignals(enabled: () => boolean = () => true): SignalSource {
  firing.read(enabled)

  /**
   * Quietens one alert and takes it off the page at once, rather than at the next poll.
   *
   * Dropped locally before the write is even sent: the line is gone the moment it is dismissed,
   * which is what dismissing means, and the poll behind it only confirms what is already true.
   * @param {string} id - Signal to quieten
   * @returns {Promise<void>}
   */
  async function silence(id: string): Promise<void> {
    firing.data.value = firing.data.value.filter((signal) => signal.id !== id)

    const response = await fetch(SIGNALS_SILENCE_URL, {
      method: 'PUT',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ id, silenced: true }),
    })

    if (!response.ok) {
      // The next poll brings it back, which is the honest outcome: it was not silenced.
      console.warn(`[diele] silencing ${id} answered ${response.status}`)
    }
  }

  return { signals: computed(() => firing.data.value), silence }
}

/**
 * Drops everything held, so the next reader starts from nothing.
 * @returns {void}
 */
export function resetSignals(): void {
  firing.reset()
}
