import type { ApiSignal, ApiSignals } from '@diele/common'
import type { Signal } from '#connectors/types.js'
import { isHttpUrl } from '#fieldSchemas.js'
import { messageOf } from '#connectors/redact.js'
import { isEnabled } from '#settings/toggles.js'
import { sortSignals } from './order.js'
import { readSilencedScopes, sweepSilences } from './silences.js'
import { listSignalTasks, type SignalTask } from './resolve.js'

/** What the client comes back at once a source has answered at least once. */
const POLL_SECONDS = 60

/**
 * What it comes back at while a source has never run. A cold portal would otherwise say nothing
 * is firing for a full minute after the first paint, which is most of the time a new tab is open.
 */
const COLD_POLL_SECONDS = 5

/**
 * How many firing signals are served at once.
 *
 * The list is collapsed behind a count and nothing past the first is reachable without opening it,
 * so a source holding thousands would send rows nobody can read on every poll. The true count goes
 * out beside them, a cap that says nothing being indistinguishable from there being no more.
 */
const MAX_SERVED = 200

/**
 * How far past its own interval an answer may be served. The same reasoning the readings use: a
 * quarter-hour-old list of what is wrong is not old, it is wrong, and here it errs towards
 * silence, which is the direction that costs the most.
 */
const STALE_AFTER = 3

interface Held {
  readonly signals: ReadonlyArray<Signal>
  readonly at: number
  readonly ttlMs: number
}

// In memory and never persisted, the way the readings are: a restart reports nothing until the
// first read answers. Module scope rather than per request, so several tabs are one read upstream.
const held = new Map<string, Held>()
const running = new Map<string, Promise<void>>()
const lastRunAt = new Map<string, number>()

/**
 * Runs one task and replaces what it holds.
 *
 * A failure leaves the last answer standing rather than clearing it: the entry ages out on its
 * own a few intervals later, and blanking the line on one missed read would report a source
 * being briefly unreachable as everything having recovered.
 * @param {SignalTask} task - Source to read
 * @returns {Promise<void>}
 */
async function refresh(task: SignalTask): Promise<void> {
  try {
    const signals = await task.run()

    held.set(task.key, { signals, at: Date.now(), ttlMs: task.ttlSeconds * 1000 })

    // Against an answer that arrived, never against a source that failed: a silence lasts as long
    // as its alert does, and an unreachable instance reports nothing, which is not the same as
    // nothing firing.
    sweepSilences(
      task.connectorId,
      signals.map((signal) => signal.id),
    )
  } catch (cause) {
    // Already logged and recorded against the connector by the resolver, so this only says the
    // held answer is being kept.
    console.warn(`[signals] keeping the last answer for ${task.key}:`, messageOf(cause))
  } finally {
    // Recorded whether or not it worked, so a source that always fails backs off to its own
    // interval instead of being retried by every reader.
    lastRunAt.set(task.key, Date.now())
    running.delete(task.key)
  }
}

/**
 * Starts a read unless one is already going or the last was recent enough.
 * @param {SignalTask} task - Source to consider
 * @returns {void}
 */
function refreshIfDue(task: SignalTask): void {
  if (running.has(task.key)) {
    return
  }

  const last = lastRunAt.get(task.key)
  if (last !== undefined && Date.now() - last < task.ttlSeconds * 1000) {
    return
  }

  // Unawaited: the reader is served what is held and the fresher answer lands for the next one,
  // the same stale-while-revalidate the readings do.
  running.set(task.key, refresh(task))
}

/**
 * Narrows one signal to what its reader may see.
 *
 * The detail quotes the alert's own annotations, which name the instance that fired it and how it
 * is addressed, so it is an admin's the way a reading's is. The link is not: it points at the
 * source's own page, which is where anyone who can see that something is firing should be able to
 * go and read it.
 *
 * The link is checked here as well as where a module builds it, this being the one funnel every
 * signal leaves by: a module composing an href out of what a remote source said would otherwise
 * put whatever that source chose behind a click on the portal's own page. Dropped rather than
 * replaced, since nothing here knows the connector's own origin to fall back to, and a signal
 * carrying no link is drawn as plain text.
 * @param {Signal} signal - Signal as the source reported it
 * @param {boolean} detailed - Whether the reader may see the source's own description
 * @returns {ApiSignal} - What to serve
 */
function toApiSignal(signal: Signal, detailed: boolean): ApiSignal {
  return {
    id: signal.id,
    severity: signal.severity,
    label: signal.label,
    ...(detailed && signal.detail ? { detail: signal.detail } : {}),
    ...(signal.href && isHttpUrl(signal.href) ? { href: signal.href } : {}),
    ...(signal.since ? { since: signal.since } : {}),
  }
}

/**
 * Serves what is currently known, reading behind the answer whatever is due.
 *
 * Never waits on a source, for the reason the readings never do: this is a new tab page, and one
 * that painted only once Prometheus had answered would be as slow as the slowest thing in the
 * homelab.
 * @param {boolean} detailed - Whether the reader may see each source's own description
 * @param {number} userId - Whoever is asking, whose silences are theirs alone
 * @returns {ApiSignals} - What is firing, and when to ask again
 */
export function readSignals(detailed: boolean, userId: number): ApiSignals {
  // Answered before anything below touches what is held, the way the readings are: the sweep
  // further down drops what no task owns any more, and letting it run here would throw away
  // every answer the moment the switch is flipped.
  if (!isEnabled('alerts')) {
    return { signals: [], silenced: { all: [], mine: [] }, total: 0, pollSeconds: POLL_SECONDS }
  }

  const tasks = listSignalTasks()

  for (const task of tasks) {
    refreshIfDue(task)
  }

  const keys = new Set(tasks.map((task) => task.key))

  // A connector that has been switched off or removed keeps neither its answer nor its place in
  // the backoff. One mid-run is spared, since its own `finally` is about to stamp it again.
  for (const key of lastRunAt.keys()) {
    if (!keys.has(key) && !running.has(key)) {
      lastRunAt.delete(key)
    }
  }

  const now = Date.now()
  const merged: Signal[] = []

  for (const [key, entry] of held) {
    if (!keys.has(key) || now - entry.at > entry.ttlMs * STALE_AFTER) {
      held.delete(key)
      continue
    }

    merged.push(...entry.signals)
  }

  const cold = tasks.some((task) => !lastRunAt.has(task.key))

  // Read per request rather than held: a silence made in one tab is meant to take the line off
  // the next tab's poll, and holding a copy here would keep it up until something expired.
  const silenced = readSilencedScopes(userId)

  // Served rather than filtered out, the way the entries serve what is hidden: a line nobody can
  // see is a line nobody can bring back, and a silence lasts only as long as its alert, so there
  // is nowhere else to go and manage one before it clears. Which of them to draw is the client's,
  // and which scope quietened each is what says who may lift it.
  const quiet = new Set([...silenced.all, ...silenced.mine])
  const ordered = sortSignals(merged)
  const firing = ordered.filter((signal) => !quiet.has(signal.id))

  // The cap falls on the firing half alone. A quietened line that did not survive it would be one
  // nobody could bring back, and there are only ever as many of those as somebody chose to make.
  const served = [
    ...firing.slice(0, MAX_SERVED),
    ...ordered.filter((signal) => quiet.has(signal.id)),
  ]

  return {
    signals: served.map((signal) => toApiSignal(signal, detailed)),
    silenced,
    total: firing.length,
    pollSeconds: cold ? COLD_POLL_SECONDS : POLL_SECONDS,
  }
}

/**
 * Returns whether a signal is one a source is currently reporting.
 *
 * What bounds the silences: a silence is a row keyed by an id the caller supplies, so accepting
 * one nothing is firing writes a row no sweep can ever reach, the sweep being per source and
 * against the ids that source answered with. Anyone signed in could then grow the table without
 * limit. Checked against what is held rather than against a shape, because a shape a caller can
 * satisfy by counting is not a bound at all.
 * @param {string} id - Signal id as the caller sent it
 * @returns {boolean} - True while some source is reporting it
 */
export function isLiveSignal(id: string): boolean {
  for (const entry of held.values()) {
    if (entry.signals.some((signal) => signal.id === id)) {
      return true
    }
  }

  return false
}

/**
 * Drops what one source answered last, so the next reader gets a fresh read rather than the
 * answer its old settings produced.
 *
 * What the switches do not need: whether the feature is on is read on the way out, so flipping it
 * takes effect on the next poll. Which alerts a source reports is decided while reading it, so
 * without this a narrower floor or a newly hidden heartbeat would sit behind the held answer
 * until its interval lapsed, and look like the setting had not taken.
 * @param {number} connectorId - Source whose held answer is now out of date
 * @returns {void}
 */
export function forgetSource(connectorId: number): void {
  const key = String(connectorId)

  held.delete(key)
  lastRunAt.delete(key)
}

/**
 * Drops everything held, for a test and for an import that replaced the configuration these were
 * read against.
 * @returns {void}
 */
export function resetSignals(): void {
  held.clear()
  running.clear()
  lastRunAt.clear()
}
