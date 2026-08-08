import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createEngine,
  deleteEngine,
  listAllEngines,
  reorderEngines,
  setEngineEnabled,
} from '#engines/repository.js'
import { POSITION_STEP } from '#db/orderedRows.js'

/**
 * Adds an engine to order around.
 * @param {string} name - Engine name, which is what makes it identifiable in a test
 * @returns {number} - Its id
 */
function engine(name: string): number {
  return createEngine({ name, urlTemplate: `https://example.com/?q={query}` }).id
}

test('an appended row lands a whole step past the last one', () => {
  const first = createEngine({ name: 'ordered-a', urlTemplate: 'https://a.test/?q={query}' })
  const second = createEngine({ name: 'ordered-b', urlTemplate: 'https://b.test/?q={query}' })

  assert.equal(second.position, first.position + POSITION_STEP)
})

test('reordering rewrites positions into the order given', () => {
  const a = engine('reorder-a')
  const b = engine('reorder-b')
  const c = engine('reorder-c')

  reorderEngines([c, a, b])

  const byId = new Map(listAllEngines().map((row) => [row.id, row.position]))
  assert.ok(byId.get(c)! < byId.get(a)!)
  assert.ok(byId.get(a)! < byId.get(b)!)
})

test('switching a row off leaves it in place', () => {
  const id = engine('switchable')

  setEngineEnabled(id, false)
  assert.equal(listAllEngines().find((row) => row.id === id)?.enabled, false)

  setEngineEnabled(id, true)
  assert.equal(listAllEngines().find((row) => row.id === id)?.enabled, true)
})

test('deleting a row removes it', () => {
  const id = engine('removable')

  deleteEngine(id)

  assert.equal(
    listAllEngines().find((row) => row.id === id),
    undefined,
  )
})

test('switching or deleting a row that is not there is a 404, not a silent no-op', () => {
  assert.throws(() => setEngineEnabled(987654, false), /not found/)
  assert.throws(() => deleteEngine(987654), /not found/)
})
