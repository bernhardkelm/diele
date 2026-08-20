import type { Signal } from '#connectors/types.js'
import { RANK } from './severity.js'

/**
 * Orders what every source reported into one list.
 *
 * Worst first, then longest-firing first within a severity: a condition that has held for hours
 * is the one that is not fixing itself, and the collapsed line shows whichever comes out on top.
 *
 * A signal carrying no `since` sorts last rather than first: nothing is known about how long it
 * has held, and reading that as "longest" would put it above one that has genuinely stood.
 * @param {ReadonlyArray<Signal>} signals - Everything held, in whatever order it was merged
 * @returns {ReadonlyArray<Signal>} - A new list in display order
 */
export function sortSignals(signals: ReadonlyArray<Signal>): ReadonlyArray<Signal> {
  return [...signals].sort(
    (a, b) => RANK[a.severity] - RANK[b.severity] || (a.since ?? '￿').localeCompare(b.since ?? '￿'),
  )
}
