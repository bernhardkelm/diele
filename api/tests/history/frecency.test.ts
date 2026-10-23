import assert from 'node:assert/strict'
import { test } from 'node:test'
import { byFrecency, frecency, recencyWeight } from '#history/frecency.js'

const DAY = 24 * 60 * 60_000
const NOW = Date.parse('2026-10-22T12:00:00.000Z')

/**
 * Builds an entry visited a number of times, last some days ago.
 * @param {string} id - Name to tell it apart by
 * @param {number} visits - How often it was visited
 * @param {number} daysAgo - When it was last visited
 * @returns {{ id: string; visits: number; lastVisitedAt: string }} - The entry
 */
function entry(
  id: string,
  visits: number,
  daysAgo: number,
): { id: string; visits: number; lastVisitedAt: string } {
  return { id, visits, lastVisitedAt: new Date(NOW - daysAgo * DAY).toISOString() }
}

test('recency weighs in steps, never down to nothing', () => {
  assert.equal(recencyWeight(0), 100)
  assert.equal(recencyWeight(4 * DAY), 100)
  assert.equal(recencyWeight(5 * DAY), 70)
  assert.equal(recencyWeight(20 * DAY), 50)
  assert.equal(recencyWeight(60 * DAY), 30)
  assert.equal(recencyWeight(400 * DAY), 10)
})

// A clock a little ahead of the server's is not a reason to rank anything lower.
test('a visit stamped in the future counts as now', () => {
  assert.equal(recencyWeight(-DAY), 100)
})

test('the score is the visit count weighted by recency', () => {
  assert.equal(frecency(entry('a', 3, 1), NOW), 300)
  assert.equal(frecency(entry('a', 3, 100), NOW), 30)
})

test('a page opened often lately outranks one opened more often long ago', () => {
  const ordered = byFrecency(
    [entry('old', 20, 200), entry('recent', 5, 2), entry('once', 1, 0)],
    NOW,
  )

  assert.deepEqual(
    ordered.map((item) => item.id),
    ['recent', 'old', 'once'],
  )
})

test('of two equal scores, the more recent leads', () => {
  const ordered = byFrecency([entry('earlier', 2, 3), entry('later', 2, 1)], NOW)

  assert.deepEqual(
    ordered.map((item) => item.id),
    ['later', 'earlier'],
  )
})
