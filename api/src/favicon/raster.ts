import { CANVAS, placeMark, type Mark } from './mark.js'

/** A colour as the three channels a pixel is written from. */
type Channels = readonly [number, number, number]

export interface IconRequest {
  /** Side of the square to draw, in pixels */
  readonly size: number
  /** Corner rounding in canvas units, zero for the full-bleed square a phone masks itself */
  readonly radius: number
  readonly plate: string
  readonly accent: string
}

// Placed once: the geometry is the same whatever size it is drawn at, and only the mapping from
// canvas units to pixels changes.
const MARK: Mark = placeMark()

/**
 * Reads a `#rrggbb` colour into its channels.
 * @param {string} hex - Colour as the configuration holds it
 * @returns {Channels} - Red, green and blue, 0 to 255
 */
function channelsOf(hex: string): Channels {
  const value = Number.parseInt(hex.slice(1), 16)

  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

/**
 * Returns how much of a pixel a shape covers, from how far the pixel's centre sits outside it.
 * A distance of half a pixel either way is the whole of the antialiasing: any wider a ramp
 * blurs an edge that is genuinely sharp.
 * @param {number} distance - Signed distance in pixels, negative inside the shape
 * @returns {number} - Coverage from 0 to 1
 */
function coverage(distance: number): number {
  return Math.min(Math.max(0.5 - distance, 0), 1)
}

/**
 * Returns the signed distance from a point to the rounded square the mark sits on.
 * @param {number} x - Point, in canvas units
 * @param {number} y - Point, in canvas units
 * @param {number} radius - Corner rounding, in canvas units
 * @returns {number} - Distance in canvas units, negative inside the plate
 */
function plateDistance(x: number, y: number, radius: number): number {
  const half = CANVAS / 2
  const dx = Math.abs(x - half) - (half - radius)
  const dy = Math.abs(y - half) - (half - radius)

  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))

  return outside + Math.min(Math.max(dx, dy), 0) - radius
}

/**
 * Returns the distance from a point to the nearest of the lines the mark was flattened into.
 * @param {number} x - Point, in canvas units
 * @param {number} y - Point, in canvas units
 * @returns {number} - Distance in canvas units
 */
function centreLineDistance(x: number, y: number): number {
  let nearest = Number.POSITIVE_INFINITY

  for (const segment of MARK.segments) {
    const dx = segment.x2 - segment.x1
    const dy = segment.y2 - segment.y1
    const lengthSquared = dx * dx + dy * dy

    // Clamped, so a point beyond either end measures against that end rather than against the
    // line the segment lies on. That is what gives the stroke its round caps and joins.
    const along =
      lengthSquared === 0
        ? 0
        : Math.min(Math.max(((x - segment.x1) * dx + (y - segment.y1) * dy) / lengthSquared, 0), 1)

    const distance = Math.hypot(x - (segment.x1 + along * dx), y - (segment.y1 + along * dy))

    if (distance < nearest) {
      nearest = distance
    }
  }

  return nearest
}

/**
 * Draws one icon into the raw pixels a PNG is written from.
 *
 * Drawn at the size asked for rather than scaled down from one large copy: a 16 pixel favicon is
 * two strokes and a corner, and everything that makes it legible at that size is decided by the
 * antialiasing at that size.
 * @param {IconRequest} request - Size, rounding and the colours to draw in
 * @returns {Buffer} - Rows of `rgba` bytes, top row first
 */
export function renderIcon(request: IconRequest): Buffer {
  const { size, radius } = request
  const plate = channelsOf(request.plate)
  const accent = channelsOf(request.accent)

  // Canvas units per pixel, and its inverse for turning a distance into a coverage.
  const perPixel = CANVAS / size
  const toPixels = size / CANVAS

  const pixels = Buffer.alloc(size * size * 4)

  // A pixel outside this cannot carry any of the mark, so the distance to a hundred segments is
  // only taken for the third of the canvas the mark actually reaches.
  const margin = perPixel
  const { bounds } = MARK

  for (let row = 0; row < size; row += 1) {
    const y = (row + 0.5) * perPixel
    const inMarkRows = y >= bounds.top - margin && y <= bounds.bottom + margin

    for (let column = 0; column < size; column += 1) {
      const x = (column + 0.5) * perPixel

      const onPlate = coverage(plateDistance(x, y, radius) * toPixels)

      const onMark =
        inMarkRows && x >= bounds.left - margin && x <= bounds.right + margin
          ? coverage((centreLineDistance(x, y) - MARK.reach) * toPixels)
          : 0

      const at = (row * size + column) * 4

      for (let channel = 0; channel < 3; channel += 1) {
        pixels[at + channel] = Math.round(
          plate[channel]! + (accent[channel]! - plate[channel]!) * onMark,
        )
      }

      // The mark never reaches past the plate, so the plate alone decides what is opaque.
      pixels[at + 3] = Math.round(onPlate * 255)
    }
  }

  return pixels
}
