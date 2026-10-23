import { computed, type ComputedRef } from 'vue'
import { polledJson } from '@/composables/usePolledJson'
import { reportLapse } from '@/composables/sessionLapse'
import { SIGNALS_SILENCE_URL, SIGNALS_URL } from '@/config/api'
import type { ApiSignal, ApiSignals, SilencedIds } from '@diele/common'

const EMPTY: ApiSignals = { signals: [], silenced: { all: [], mine: [] }, total: 0, pollSeconds: 60 }

export interface SilencedSignal {
  readonly signal: ApiSignal
  /** Whether the portal quietened it, rather than the account looking at it */
  readonly byPortal: boolean
  /** Whether whoever is looking may bring it back */
  readonly restorable: boolean
}

export interface SignalSource {
  /** What is firing and not quietened, worst first, up to the cap the server serves */
  signals: ComputedRef<ReadonlyArray<ApiSignal>>
  /** How many are firing in all, which is more than `signals` holds once the cap bites */
  total: ComputedRef<number>
  /** What is firing but quietened, with who may bring each one back */
  silenced: ComputedRef<ReadonlyArray<SilencedSignal>>
  /**
   * Quietens one alert for this portal, never in the source: an admin takes it off the page for
   * everyone and anyone else takes it off their own. It comes back on its own if the condition
   * clears and fires again.
   */
  silence: (id: string) => Promise<void>
  /**
   * Brings one back. Only in the scope whoever is asking owns: an admin lifts the portal's and
   * everyone else lifts their own, which is the same rule that decided where it landed.
   */
  restore: (id: string) => Promise<void>
}

// Shared at module scope the way the readings are: one document, however many components read it.
// Both halves are filled in on the way out rather than trusted: an api older than the bundle in
// front of it answers without the silences at all, and reading through a missing one would take
// the whole page down over a line it was only going to draw as empty.
const firing = polledJson<ApiSignals, ApiSignals>({
  url: SIGNALS_URL,
  empty: EMPTY,
  select: (payload) => ({
    signals: payload?.signals ?? [],
    silenced: {
      all: payload?.silenced?.all ?? [],
      mine: payload?.silenced?.mine ?? [],
    },
    total: payload?.total ?? payload?.signals?.length ?? 0,
    pollSeconds: payload?.pollSeconds ?? EMPTY.pollSeconds,
  }),
  whenUnavailable: 'alerts unavailable, keeping the last answer',
})

/**
 * Moves one id in or out of the scope the reader owns, so the line changes at once rather than at
 * the next poll.
 * @param {SilencedIds} held - Both scopes as the server last served them
 * @param {string} id - Signal being quietened or brought back
 * @param {boolean} admin - Whether this account speaks for the portal
 * @param {boolean} silenced - True to quieten it
 * @returns {SilencedIds} - Both scopes with the change applied
 */
function withSilence(
  held: SilencedIds,
  id: string,
  admin: boolean,
  silenced: boolean,
): SilencedIds {
  const key = admin ? 'all' : 'mine'
  const scope = held[key].filter((held) => held !== id)

  return { ...held, [key]: silenced ? [...scope, id] : scope }
}

/**
 * Tracks what the connected sources report as firing. Polled and idle in the background, like
 * the readings, and gated by the caller so a portal with the feature switched off never asks.
 * @param {() => boolean} enabled - Whether the view reading these is on screen and wants them
 * @param {() => boolean} admin - Whether this account silences for the portal rather than itself
 * @returns {SignalSource} - What is firing, what is quietened, and the writes that move one
 */
export function useSignals(
  enabled: () => boolean = () => true,
  admin: () => boolean = () => false,
): SignalSource {
  firing.read(enabled)

  const quietened = computed(() => new Set(firing.data.value.silenced.all))
  const mine = computed(() => new Set(firing.data.value.silenced.mine))

  const signals = computed(() =>
    firing.data.value.signals.filter(
      (signal) => !quietened.value.has(signal.id) && !mine.value.has(signal.id),
    ),
  )

  const silenced = computed(() =>
    firing.data.value.signals
      .filter((signal) => quietened.value.has(signal.id) || mine.value.has(signal.id))
      .map((signal) => {
        const byPortal = quietened.value.has(signal.id)

        return {
          signal,
          byPortal,
          // An admin lifts the portal's and everyone else lifts their own, so a line quietened in
          // the other scope carries no way back rather than one that would do nothing.
          restorable: byPortal ? admin() : !admin(),
        }
      }),
  )

  /**
   * Writes one change and moves the line at once, rather than at the next poll.
   *
   * Applied locally before the write is even sent: the line moves the moment it is pressed, which
   * is what pressing it means, and the poll behind it only confirms what is already true.
   * @param {string} id - Signal to quieten or bring back
   * @param {boolean} next - True to quieten it
   * @returns {Promise<void>}
   */
  async function write(id: string, next: boolean): Promise<void> {
    const held = firing.data.value
    const known = held.silenced.all.includes(id) || held.silenced.mine.includes(id)

    firing.data.value = {
      ...held,
      silenced: withSilence(held.silenced, id, admin(), next),
      // Moves with the line, the count being of what is firing and not quietened. Only where this
      // actually changes which side the line is on, so pressing the same control twice does not
      // walk the count away from the truth.
      total: known === next ? held.total : Math.max(0, held.total + (next ? -1 : 1)),
    }

    const response = await fetch(SIGNALS_SILENCE_URL, {
      method: 'PUT',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ id, silenced: next }),
    })

    if (!response.ok) {
      reportLapse(response.status)
      // The next poll puts it back where it was, which is the honest outcome: nothing changed.
      console.warn(`[diele] silencing ${id} answered ${response.status}`)
    }
  }

  return {
    signals,
    total: computed(() => firing.data.value.total),
    silenced,
    silence: (id) => write(id, true),
    restore: (id) => write(id, false),
  }
}

/**
 * Drops everything held, so the next reader starts from nothing.
 * @returns {void}
 */
export function resetSignals(): void {
  firing.reset()
}
