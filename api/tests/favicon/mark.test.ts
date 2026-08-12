import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { MARK_PATH, placeMark, STROKE_WIDTH } from '#favicon/mark.js'

// The mark is drawn twice, once here and once by the browser, and its geometry is fixed. Read
// out of the component rather than restated, so a change to either copy fails here instead of
// leaving the two quietly apart.
const TILDE = readFileSync(
  join(import.meta.dirname, '../../../web/src/components/BrandTilde.vue'),
  'utf8',
)

test('the path is the one the browser draws', () => {
  assert.equal(TILDE.match(/\sd="([^"]+)"/)?.[1], MARK_PATH)
})

test('the stroke is the one the browser draws', () => {
  assert.equal(TILDE.match(/stroke-width="([^"]+)"/)?.[1], String(STROKE_WIDTH))
})

// The curves bend towards their control points without reaching them, so the bounds the
// rasteriser culls against cannot be read off the declared points. Taken from the flattened line
// here, which arrives at them by walking the curve rather than by solving it.
test('the bounds are what the flattened curves reach, round caps included', () => {
  const { segments, bounds, reach } = placeMark()
  const across = segments.flatMap((segment) => [segment.x1, segment.x2])
  const down = segments.flatMap((segment) => [segment.y1, segment.y2])

  assert.ok(Math.abs(Math.min(...across) - reach - bounds.left) < 1e-6, 'left')
  assert.ok(Math.abs(Math.max(...across) + reach - bounds.right) < 1e-6, 'right')
  assert.ok(Math.abs(Math.min(...down) - reach - bounds.top) < 1e-6, 'top')
  assert.ok(Math.abs(Math.max(...down) + reach - bounds.bottom) < 1e-6, 'bottom')
})
