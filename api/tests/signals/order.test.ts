import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sortSignals } from '#signals/order.js'
import type { Signal } from '#connectors/types.js'

/**
 * Builds one signal with only what the ordering reads.
 * @param {string} label - What is firing, which the assertions name it by
 * @param {Signal['severity']} severity - How loud it is
 * @param {string | undefined} since - When it started firing
 * @returns {Signal} - The signal
 */
function signal(label: string, severity: Signal['severity'], since?: string): Signal {
  return { id: label, label, severity, ...(since ? { since } : {}) }
}

test('critical leads whatever order they arrived in', () => {
  const sorted = sortSignals([
    signal('DiskFilling', 'warning', '2026-08-12T08:00:00Z'),
    signal('PostgresDown', 'critical', '2026-08-12T09:00:00Z'),
  ])

  assert.deepEqual(
    sorted.map((entry) => entry.label),
    ['PostgresDown', 'DiskFilling'],
  )
})

// A condition that has held for hours is the one that is not fixing itself.
test('the longest-firing leads within a severity', () => {
  const sorted = sortSignals([
    signal('Newer', 'critical', '2026-08-12T09:00:00Z'),
    signal('Older', 'critical', '2026-08-12T06:00:00Z'),
  ])

  assert.deepEqual(
    sorted.map((entry) => entry.label),
    ['Older', 'Newer'],
  )
})

test('one that never said when sorts last rather than oldest', () => {
  const sorted = sortSignals([
    signal('Undated', 'critical'),
    signal('Dated', 'critical', '2026-08-12T09:00:00Z'),
  ])

  assert.deepEqual(
    sorted.map((entry) => entry.label),
    ['Dated', 'Undated'],
  )
})

test('the list handed in is left alone', () => {
  const original = [signal('DiskFilling', 'warning'), signal('PostgresDown', 'critical')]
  sortSignals(original)

  assert.equal(original[0]?.label, 'DiskFilling')
})
