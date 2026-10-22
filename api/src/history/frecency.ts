const DAY_MS = 24 * 60 * 60_000

// Firefox's recency buckets: a visit counts fully for four days, then less in steps, so a page
// opened often last year still ranks below one opened a few times this week.
const BUCKETS: ReadonlyArray<readonly [days: number, weight: number]> = [
  [4, 100],
  [14, 70],
  [31, 50],
  [90, 30],
]

const OLDEST_WEIGHT = 10

export interface Frecent {
  readonly visits: number
  /** ISO 8601 */
  readonly lastVisitedAt: string
}

/**
 * Weighs how recent a visit is.
 * @param {number} ageMs - How long ago it happened, in ms
 * @returns {number} - Weight from the bucket it falls in
 */
export function recencyWeight(ageMs: number): number {
  const days = Math.max(0, ageMs) / DAY_MS
  const bucket = BUCKETS.find(([limit]) => days <= limit)

  return bucket ? bucket[1] : OLDEST_WEIGHT
}

/**
 * Scores an entry by how often and how recently it was visited.
 * @param {Frecent} entry - Entry to score
 * @param {number} now - Current time, in ms since the epoch
 * @returns {number} - Visit count weighted by recency
 */
export function frecency(entry: Frecent, now: number): number {
  return entry.visits * recencyWeight(now - Date.parse(entry.lastVisitedAt))
}

/**
 * Orders entries most frecent first, the more recent of two equal scores leading.
 * @param {ReadonlyArray<T>} entries - Entries to order
 * @param {number} now - Current time, in ms since the epoch
 * @returns {T[]} - A sorted copy
 */
export function byFrecency<T extends Frecent>(entries: ReadonlyArray<T>, now: number): T[] {
  const scored = entries.map((entry) => ({ entry, score: frecency(entry, now) }))

  scored.sort(
    (a, b) => b.score - a.score || b.entry.lastVisitedAt.localeCompare(a.entry.lastVisitedAt),
  )

  return scored.map(({ entry }) => entry)
}
