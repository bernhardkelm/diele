import type { ApiHealth, ApiHealthReading } from '@diele/common'
import type { HealthReading } from '#connectors/types.js'
import { messageOf } from '#connectors/redact.js'
import { isEnabled } from '#settings/toggles.js'
import { listProviderTasks, taskForRef, type ProviderTask } from './resolve.js'

/** What the client comes back at once a provider has answered at least once. */
const POLL_SECONDS = 60

/**
 * What it comes back at while a provider has never run. A cold portal would otherwise show no
 * dots for a full minute after the first paint, which is most of the time a new tab is open.
 */
const COLD_POLL_SECONDS = 5

/**
 * How far past its own refresh interval a reading may be served. Entries are cached in the
 * database because a quarter-hour-old repo list beats an empty section; a reading is the
 * opposite, because a quarter-hour-old "up" is not old, it is wrong.
 */
const STALE_AFTER = 3

interface Held {
  readonly reading: HealthReading
  readonly at: number
  readonly ttlMs: number
}

// In memory and never persisted, so a restart shows no dots until the first refresh answers.
// Module scope rather than per request: several tabs and several people are one poll upstream.
const held = new Map<string, Held>()
const running = new Map<string, Promise<void>>()
const lastRunAt = new Map<string, number>()

/**
 * Runs one provider and replaces the readings it owns. Refs the run did not answer for are
 * dropped rather than left standing, so a monitor someone deleted stops decorating its card.
 * @param {ProviderTask} task - Provider to refresh
 * @returns {Promise<void>}
 */
async function refresh(task: ProviderTask): Promise<void> {
  const ttlMs = task.ttlSeconds * 1000

  try {
    const readings = await task.run()
    const at = Date.now()

    for (const ref of task.refs) {
      const reading = readings.get(ref)

      if (reading) {
        held.set(ref, { reading, at, ttlMs })
      } else {
        held.delete(ref)
      }
    }
  } catch (cause) {
    // A task's own run already swallows what its source did; reaching here is a bug in the
    // resolver rather than an unreachable service, so it says so and leaves the last readings.
    console.warn(`[health] refreshing ${task.key} failed:`, messageOf(cause))
  } finally {
    // Recorded whether or not it worked, so a provider that always fails backs off to its own
    // interval instead of being retried by every reader.
    lastRunAt.set(task.key, Date.now())
    running.delete(task.key)
  }
}

/**
 * Starts a refresh unless one is already going or the last was recent enough.
 * @param {ProviderTask} task - Provider to consider
 * @returns {void}
 */
function refreshIfDue(task: ProviderTask): void {
  if (running.has(task.key)) {
    return
  }

  const last = lastRunAt.get(task.key)
  if (last !== undefined && Date.now() - last < task.ttlSeconds * 1000) {
    return
  }

  // Unawaited: the reader is served what is held and the fresher answer lands for the next one.
  // The same stale-while-revalidate the client already does with its cached entries.
  running.set(task.key, refresh(task))
}

/**
 * Serves what is currently known, refreshing behind the answer whatever is due.
 *
 * Never waits on a source: this is a new tab page, and a portal that painted only once
 * Prometheus had answered would be as slow as the slowest thing in the homelab.
 * @param {boolean} detailed - Whether the reader may see each source's own description
 * @returns {ApiHealth} - Readings by ref, and when to ask again
 */
export function readHealth(detailed: boolean): ApiHealth {
  // Answered before anything below touches what is held. Switched off is not the same as nothing
  // bound: the sweep further down drops readings nothing is bound to any more, and letting it run
  // here would throw away every dot the moment the switch is flipped, leaving the portal blank
  // for a full interval after it is flipped back.
  if (!isEnabled('health')) {
    return { readings: {}, pollSeconds: POLL_SECONDS }
  }

  const tasks = listProviderTasks()
  const bound = new Set(tasks.flatMap((task) => task.refs))

  for (const task of tasks) {
    refreshIfDue(task)
  }

  // A provider nothing is bound to any more keeps no place in the backoff. Left standing, a
  // connector removed and replaced would hold its key for the life of the process. One that is
  // mid-run is spared, since its own `finally` is about to stamp it again anyway.
  const keys = new Set(tasks.map((task) => task.key))

  for (const key of lastRunAt.keys()) {
    if (!keys.has(key) && !running.has(key)) {
      lastRunAt.delete(key)
    }
  }

  const now = Date.now()
  const readings: Record<string, ApiHealthReading> = {}

  for (const [ref, entry] of held) {
    // A ref nothing is bound to any more is dropped rather than served from a binding that has
    // since been changed or removed.
    if (!bound.has(ref)) {
      held.delete(ref)
      continue
    }

    if (now - entry.at > entry.ttlMs * STALE_AFTER) {
      held.delete(ref)
      continue
    }

    readings[ref] = {
      state: entry.reading.state,
      ...(entry.reading.uptime === undefined ? {} : { uptime: entry.reading.uptime }),
      // A monitor name or a label set says which internal hosts exist and how they answer, the
      // same reason a sync error is narrowed in the entries route.
      ...(detailed && entry.reading.detail ? { detail: entry.reading.detail } : {}),
    }
  }

  const cold = tasks.some((task) => !lastRunAt.has(task.key))

  return { readings, pollSeconds: cold ? COLD_POLL_SECONDS : POLL_SECONDS }
}

/**
 * Resolves one entry now and waits for the answer, for someone who has just bound it and is
 * asking whether it works. The reading is held like any other, so the portal draws it on its
 * next poll instead of waiting out an interval to find out what the panel already knows.
 *
 * Never throws: this runs after the binding is already stored, and a source being unreachable is
 * an answer about the source rather than a reason to report the save as failed.
 * @param {string} ref - Entry to resolve
 * @returns {Promise<HealthReading | undefined>} - How it answered, or undefined when nothing did
 */
export async function probeNow(ref: string): Promise<HealthReading | undefined> {
  const task = taskForRef(ref)
  if (!task) {
    held.delete(ref)
    return undefined
  }

  try {
    const reading = (await task.run()).get(ref)

    if (reading) {
      held.set(ref, { reading, at: Date.now(), ttlMs: task.ttlSeconds * 1000 })
    } else {
      held.delete(ref)
    }

    // Deliberately not recorded as the provider's own run: this asked about one entry, and
    // marking the whole provider fresh would leave every other entry bound to it waiting out a
    // full interval for a reading this never fetched.

    return reading
  } catch (cause) {
    console.warn(`[health] probing ${ref} failed:`, messageOf(cause))
    return undefined
  }
}

/**
 * Reads what is held for one entry without reaching anything, for a list that is already being
 * served and only wants to say what it knows.
 * @param {string} ref - Entry to look up
 * @returns {HealthReading | undefined} - The reading, or undefined when there is none
 */
export function peekReading(ref: string): HealthReading | undefined {
  if (!isEnabled('health')) {
    return undefined
  }

  const entry = held.get(ref)
  if (!entry || Date.now() - entry.at > entry.ttlMs * STALE_AFTER) {
    return undefined
  }

  return entry.reading
}

/**
 * Drops everything held, for a test and for an import that replaced the configuration the
 * readings were resolved against.
 * @returns {void}
 */
export function resetHealth(): void {
  held.clear()
  running.clear()
  lastRunAt.clear()
}
