import { onBeforeUnmount, onMounted, shallowRef, watch, type ShallowRef } from 'vue'
import { useVisibilityChange } from '@/composables/useVisibilityChange'

/** What to come back at before the server has said, and the floor on whatever it does say. */
const DEFAULT_POLL_MS = 60_000
const MIN_POLL_MS = 5_000

/** Every document polled this way says when to come back, because only the server knows. */
interface Paced {
  readonly pollSeconds?: number
}

export interface PolledJson<T> {
  /** What the last answer held, or the empty value until one has arrived */
  readonly data: ShallowRef<T>
  /**
   * Joins this document's readers for the life of the calling component, polling while the
   * predicate holds and the tab is in front. Called during setup, like any other composable.
   */
  readonly read: (enabled: () => boolean) => void
  /** Drops what is held and stops polling, so the next reader starts from nothing */
  readonly reset: () => void
}

export interface PolledJsonOptions<T, P extends Paced> {
  readonly url: string
  /** What is on screen before anything has answered, and what a reset goes back to */
  readonly empty: T
  /** Pulls this document's own body out of the payload */
  readonly select: (payload: P) => T
  /** What the console says when a poll fails, in the portal's own words */
  readonly whenUnavailable: string
}

/**
 * Builds one polled document: fetched on a cadence the server sets, shared by every component
 * that reads it, and idle while nothing is looking at it.
 *
 * One of these per document rather than one per reader, because a document is one document: the
 * card grid and the site list both wanting the readings must not mean two polls.
 *
 * Called at module scope by the composable that owns the document, so its state outlives any one
 * component the way the entries and the config do.
 * @param {PolledJsonOptions<T, P>} options - Where to fetch it from and how to read it
 * @returns {PolledJson<T>} - The held value and the controls over it
 */
export function polledJson<T, P extends Paced>(options: PolledJsonOptions<T, P>): PolledJson<T> {
  const data = shallowRef<T>(options.empty)
  let pollMs = DEFAULT_POLL_MS

  let timer: ReturnType<typeof setTimeout> | undefined
  let readers = 0
  let inFlight: AbortController | undefined

  // Stamped on each chain of timeouts so an older one cannot outlive the one that replaced it: it
  // is bumped by every start and every stop, and a chain whose stamp is stale stops where it is.
  let generation = 0

  /**
   * Fetches the document and replaces what is on screen.
   *
   * A failure keeps the last answer rather than clearing it: the API holds its own cache and
   * drops whatever is genuinely stale, so what is on screen is either current or already gone.
   * @param {number} stamp - Generation the calling chain was started under
   * @returns {Promise<void>}
   */
  async function load(stamp: number): Promise<void> {
    const controller = new AbortController()
    inFlight = controller

    try {
      const response = await fetch(options.url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`${options.url} responded ${response.status}`)
      }

      const payload = (await response.json()) as P

      // A reply to a chain that has since been replaced is older than what is on screen by
      // definition, however late it arrives, so it is dropped rather than painted.
      if (stamp !== generation) {
        return
      }

      data.value = options.select(payload)

      // The server decides the cadence, because only it knows whether a source has answered yet:
      // a cold portal is told to come back in seconds so the first answer is not a minute late.
      const next = Number(payload.pollSeconds) * 1000
      pollMs = Number.isFinite(next) && next > 0 ? Math.max(next, MIN_POLL_MS) : DEFAULT_POLL_MS
    } catch (error) {
      if (controller.signal.aborted) {
        return
      }

      console.warn(`[diele] ${options.whenUnavailable}:`, error)
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

    timer = setTimeout(() => void tick(stamp), pollMs)
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
   * Starts polling, refreshing once immediately. Does nothing while the tab is in the background
   * or nothing is reading, so a portal opened behind another window stays idle until looked at.
   * @returns {void}
   */
  function start(): void {
    stop()

    if (readers === 0 || document.hidden) {
      return
    }

    void tick(generation)
  }

  return {
    data,
    read(enabled: () => boolean): void {
      // a backgrounded portal stays idle, and whatever changed while it was away is refreshed on
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

      // These need a session and are drawn by one view, so a gate nobody has signed in at and a
      // panel that draws none of this both poll for nothing.
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
    },
    reset(): void {
      stop()
      readers = 0
      data.value = options.empty
      pollMs = DEFAULT_POLL_MS
    },
  }
}
