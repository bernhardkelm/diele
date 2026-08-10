import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useVisibilityChange } from '@/composables/useVisibilityChange'
import { HEALTH_URL } from '@/config/api'
import type { ApiHealth, ApiHealthReading } from '@diele/common'

/** What to come back at before the server has said, and the floor on whatever it does say. */
const DEFAULT_POLL_MS = 60_000
const MIN_POLL_MS = 5_000

const EMPTY: Record<string, ApiHealthReading> = {}

export interface HealthSource {
  /** How an entry last answered; undefined for one unbound, or whose source is switched off or gone */
  readingFor: (ref: string) => ApiHealthReading | undefined
}

// Shared at module scope the way the config and the entries are: the readings are one document,
// and the card grid and the site list asking for them must not mean two polls.
const readings = ref<Record<string, ApiHealthReading>>(EMPTY)
const pollMs = ref(DEFAULT_POLL_MS)

let timer: ReturnType<typeof setTimeout> | undefined
let readers = 0
let inFlight: AbortController | undefined

// Stamped on each chain of timeouts so an older one cannot outlive the one that replaced it: it
// is bumped by every start and every stop, and a chain whose stamp is stale stops where it is.
let generation = 0

/**
 * Fetches the readings and replaces what is on screen.
 *
 * A failure keeps the last readings rather than clearing them: the API holds its own cache and
 * drops anything genuinely stale, so what is on screen is either current or already gone, and
 * blanking every dot over one missed poll would read as "nothing is monitored".
 * @param {number} stamp - Generation the calling chain was started under
 * @returns {Promise<void>}
 */
async function load(stamp: number): Promise<void> {
  const controller = new AbortController()
  inFlight = controller

  try {
    const response = await fetch(HEALTH_URL, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`health responded ${response.status}`)
    }

    const payload = (await response.json()) as ApiHealth

    // A reply to a chain that has since been replaced is older than what is on screen by
    // definition, however late it arrives, so it is dropped rather than painted.
    if (stamp !== generation) {
      return
    }

    readings.value = payload.readings ?? EMPTY

    // The server decides the cadence, because only it knows whether a source has answered yet:
    // a cold portal is told to come back in seconds so the first dots are not a minute late.
    const next = Number(payload.pollSeconds) * 1000
    pollMs.value = Number.isFinite(next) && next > 0 ? Math.max(next, MIN_POLL_MS) : DEFAULT_POLL_MS
  } catch (error) {
    if (controller.signal.aborted) {
      return
    }

    console.warn('[diele] liveness unavailable, keeping the last readings:', error)
  } finally {
    if (inFlight === controller) {
      inFlight = undefined
    }
  }
}

/**
 * Refreshes once and schedules the next run at whatever cadence the last answer asked for.
 * A chain of timeouts rather than an interval, because the cadence changes between polls.
 * @param {number} stamp - Generation this chain was started under
 * @returns {Promise<void>}
 */
async function tick(stamp: number): Promise<void> {
  await load(stamp)

  // Rechecked rather than assumed: a request outlives the state it was sent under, so the tab
  // may have gone behind or the last reader gone away while this one was open.
  if (stamp !== generation || readers === 0 || document.hidden) {
    return
  }

  timer = setTimeout(() => void tick(stamp), pollMs.value)
}

/**
 * Stops polling and abandons whatever is in flight.
 * @returns {void}
 */
function stop(): void {
  generation += 1

  if (timer !== undefined) {
    clearTimeout(timer)
  }

  timer = undefined

  inFlight?.abort()
  inFlight = undefined
}

/**
 * Starts polling, refreshing once immediately. Does nothing while the tab is in the background or
 * nothing is reading, so a portal opened behind another window stays idle until it is looked at.
 * @returns {void}
 */
function start(): void {
  stop()

  if (readers === 0 || document.hidden) {
    return
  }

  void tick(generation)
}

/**
 * Tracks how each bound card and saved site last answered. Polled rather than pushed, and idle
 * while the tab is in the background: a new tab page spends most of its life behind another one,
 * and polling into it would be load nobody can see the result of.
 * @param {() => boolean} enabled - Whether the view reading these is on screen at all
 * @returns {HealthSource} - Reactive readings by ref
 */
export function useHealth(enabled: () => boolean = () => true): HealthSource {
  // a backgrounded portal stays idle, and a dot that changed while it was away is refreshed on
  // the way back rather than waited for
  useVisibilityChange((hidden) => {
    if (hidden) {
      stop()
      return
    }

    if (enabled()) {
      start()
    }
  })

  // The readings need a session and are drawn by one view, so a gate nobody has signed in at and
  // a panel that draws no dot both poll for nothing.
  watch(enabled, (on) => {
    if (on) {
      start()
      return
    }

    stop()
  })

  onMounted(() => {
    readers += 1

    if (enabled()) {
      start()
    }
  })

  onBeforeUnmount(() => {
    readers -= 1

    if (readers <= 0) {
      readers = 0
      stop()
    }
  })

  return { readingFor: (ref: string) => readings.value[ref] }
}

/**
 * Drops everything held, so the next reader starts from nothing.
 * @returns {void}
 */
export function resetHealth(): void {
  stop()
  readers = 0
  readings.value = EMPTY
  pollMs.value = DEFAULT_POLL_MS
}
