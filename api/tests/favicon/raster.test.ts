import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CANVAS, PLATE, PLATE_RADIUS, placeMark } from '#favicon/mark.js'
import { renderIcon } from '#favicon/raster.js'

const ACCENT = '#22c55e'
const SIZE = 64

/**
 * Reads one pixel out of a rendered icon.
 * @param {Buffer} pixels - Rows of `rgba` bytes
 * @param {number} x - Column
 * @param {number} y - Row
 * @returns {ReadonlyArray<number>} - The four channels
 */
function pixelAt(pixels: Buffer, x: number, y: number): ReadonlyArray<number> {
  const at = (y * SIZE + x) * 4

  return [pixels[at]!, pixels[at + 1]!, pixels[at + 2]!, pixels[at + 3]!]
}

/**
 * Draws the icon every case here reads from.
 * @param {number} radius - Corner rounding in canvas units
 * @returns {Buffer} - The pixels
 */
function draw(radius: number): Buffer {
  return renderIcon({ size: SIZE, radius, plate: PLATE, accent: ACCENT })
}

test('the pixels are four channels a pixel, one row after another', () => {
  assert.equal(draw(0).length, SIZE * SIZE * 4)
})

test('the mark is drawn in the accent where the stroke passes', () => {
  const pixels = draw(0)
  const { segments } = placeMark()
  const middle = segments[Math.floor(segments.length / 2)]!

  const [red, green, blue, alpha] = pixelAt(
    pixels,
    Math.round((middle.x1 / CANVAS) * SIZE),
    Math.round((middle.y1 / CANVAS) * SIZE),
  )

  assert.deepEqual([red, green, blue], [0x22, 0xc5, 0x5e])
  assert.equal(alpha, 255)
})

test('the plate is drawn everywhere the mark is not', () => {
  const pixels = draw(0)

  // Under the mark's left end, well clear of the stroke.
  const [red, green, blue, alpha] = pixelAt(pixels, 4, SIZE - 4)

  assert.deepEqual([red, green, blue], [0x0e, 0x0f, 0x12])
  assert.equal(alpha, 255)
})

// The icons a phone masks itself are square, since rounding a shape the OS is about to round
// again leaves a pale rim around the icon.
test('a square icon is opaque into its corners', () => {
  const pixels = draw(0)

  for (const [x, y] of [
    [0, 0],
    [SIZE - 1, 0],
    [0, SIZE - 1],
    [SIZE - 1, SIZE - 1],
  ]) {
    assert.equal(pixelAt(pixels, x!, y!)[3], 255, `${x},${y}`)
  }
})

test('a rounded icon has nothing in its corners', () => {
  const pixels = draw(PLATE_RADIUS)

  assert.equal(pixelAt(pixels, 0, 0)[3], 0)
  assert.equal(pixelAt(pixels, SIZE - 1, SIZE - 1)[3], 0)
  // and is still solid where the plate genuinely is
  assert.equal(pixelAt(pixels, SIZE / 2, SIZE - 2)[3], 255)
})

// Everything that makes a 16 pixel favicon legible is decided by the antialiasing at that size,
// so an edge has to be drawn softly rather than snapped to whole pixels.
test('an edge is drawn with partial coverage rather than a hard step', () => {
  const pixels = draw(PLATE_RADIUS)
  const alphas = new Set<number>()

  for (let x = 0; x < SIZE; x += 1) {
    for (let y = 0; y < SIZE; y += 1) {
      alphas.add(pixelAt(pixels, x, y)[3]!)
    }
  }

  const partial = [...alphas].filter((alpha) => alpha > 0 && alpha < 255)

  assert.ok(partial.length > 0, 'the rounded corner is antialiased')
})

test('the mark stays inside the circle a maskable icon is cropped to', () => {
  const { bounds } = placeMark()
  const centre = CANVAS / 2
  const safeRadius = 0.4 * CANVAS

  for (const [x, y] of [
    [bounds.left, bounds.top],
    [bounds.right, bounds.top],
    [bounds.left, bounds.bottom],
    [bounds.right, bounds.bottom],
  ]) {
    assert.ok(
      Math.hypot(x! - centre, y! - centre) <= safeRadius,
      `the mark reaches ${x},${y}, outside the safe circle`,
    )
  }
})
