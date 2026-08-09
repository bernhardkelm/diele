import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useVisibilityChange } from '@/composables/useVisibilityChange'
import { HEALTH_URL } from '@/config/api'
import type { ApiHealth, ApiHealthReading } from '@diele/common'

/** What to come back at before the server has said, and the floor on whatever it does say. */
const DEFAULT_POLL_MS = 60_000
const MIN_POLL_MS = 5_000

const EMPTY: Record<string, ApiHealthReading> = {}

export interface HealthSource {
  /** How an entry last answered; undefined for one that is unbound or whose source is unreachable */
  readingFor: (ref: string) => ApiHealthReading | undefined
}

// Shared at module scope the way the config and the entries are: the readings are one document,
// and the card grid and the site list asking for them must not mean two polls.
const readings = ref<Record<string, ApiHealthReading>>(EMPTY)
const pollMs = ref(DEFAULT_POLL_MS)

let timer: ReturnType<typeof setTimeout> | undefined
let readers = 0

/**
 * Fetches the readings and replaces what is on screen.
 *
 * A failure keeps the last readings rather than clearing them: the API holds its own cache and
 * drops anything genuinely stale, so what is on screen is either current or already gone, and
 * blanking every dot over one missed poll would read as "nothing is monitored".
 * @returns {Promise<void>}
 */
async function load(): Promise<void> {
  try {
    const response = await fetch(HEALTH_URL, { headers: { accept: 'application/json' } })
    if (!response.ok) {
      throw new Error(`health responded ${response.status}`)
    }

    const payload = (await response.json()) as ApiHealth
    readings.value = payload.readings ?? EMPTY

    // The server decides the cadence, because only it knows whether a source has answered yet:
    // a cold portal is told to come back in seconds so the first dots are not a minute late.
    const next = Number(payload.pollSeconds) * 1000
    pollMs.value = Number.isFinite(next) && next > 0 ? Math.max(next, MIN_POLL_MS) : DEFAULT_POLL_MS
  } catch (error) {
    console.warn('[diele] liveness unavailable, keeping the last readings:', error)
  }
}

/**
 * Refreshes once and schedules the next run at whatever cadence the last answer asked for.
 * A chain of timeouts rather than an interval, because the cadence changes between polls.
 * @returns {Promise<void>}
 */
async function tick(): Promise<void> {
  await load()

  if (readers > 0) {
    timer = setTimeout(() => void tick(), pollMs.value)
  }
}

/**
 * Starts polling, refreshing once immediately.
 * @returns {void}
 */
function start(): void {
  stop()
  void tick()
}

/**
 * Stops polling.
 * @returns {void}
 */
function stop(): void {
  if (timer !== undefined) {
    clearTimeout(timer)
  }
  timer = undefined
}

/**
 * Tracks how each bound card and saved site last answered. Polled rather than pushed, and idle
 * while the tab is in the background: a new tab page spends most of its life behind another one,
 * and polling into it would be load nobody can see the result of.
 * @returns {HealthSource} - Reactive readings by ref
 */
export function useHealth(): HealthSource {
  // a backgrounded portal stays idle, and a dot that changed while it was away is refreshed on
  // the way back rather than waited for
  useVisibilityChange((hidden) => {
    if (hidden) {
      stop()
      return
    }

    start()
  })

  onMounted(() => {
    readers += 1
    start()
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
