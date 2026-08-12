/** Side of the square every icon is drawn in, before it is scaled to the size asked for. */
export const CANVAS = 64

/**
 * Corner rounding of the plate, as a share of the canvas. Only the icons a browser draws
 * untouched carry it; the ones a phone masks itself are square, since rounding a shape the OS
 * is about to round again leaves a pale rim around the icon.
 */
export const PLATE_RADIUS = 0.22 * CANVAS

/**
 * The two page colours, named a second time here because `web/src/styles/tokens.css` cannot be
 * read from this process and neither side may change them alone.
 */
export const PAGE_LIGHT = '#f6f7f9'
export const PAGE_DARK = '#0e0f12'

/**
 * The plate the mark sits on. Not derived from the accent: the mark has to read against it, and
 * a plate taking a colour someone chose would stop being a background the moment the two were
 * close. The dark page, in both themes, because an icon sits on a taskbar or a home screen whose
 * colour this portal knows nothing about and a dark plate is the one that reads on either.
 */
export const PLATE = PAGE_DARK

/** One quadratic segment of the mark, in the 40x24 space the brand mark is drawn in. */
interface Curve {
  readonly from: readonly [number, number]
  readonly control: readonly [number, number]
  readonly to: readonly [number, number]
}

/**
 * The tilde, as `web/src/components/BrandTilde.vue` draws it: two quadratic curves through a
 * 40x24 box, stroked round at both ends. Its geometry is fixed, so this is a second copy of the
 * same numbers rather than a variation on them, and neither side may change them alone.
 */
const CURVES: ReadonlyArray<Curve> = [
  { from: [4, 13], control: [11, 3], to: [19, 13] },
  { from: [19, 13], control: [27, 23], to: [35, 13] },
]

/**
 * Returns a coordinate on a quadratic curve.
 * @param {number} from - Start coordinate
 * @param {number} control - Control coordinate
 * @param {number} to - End coordinate
 * @param {number} t - Position along the curve, 0 to 1
 * @returns {number} - The coordinate
 */
function valueAt(from: number, control: number, to: number, t: number): number {
  const inverse = 1 - t

  return inverse * inverse * from + 2 * inverse * t * control + t * t * to
}

/**
 * Returns the coordinates a curve reaches along one axis: both ends, and the turning point where
 * it has one. A quadratic bends towards its control point without reaching it, so the declared
 * points are not where the paint stops.
 * @param {Curve} curve - Curve to measure
 * @param {0 | 1} axis - 0 across, 1 down
 * @returns {ReadonlyArray<number>} - Coordinates the extrema are taken from
 */
function extentOf(curve: Curve, axis: 0 | 1): ReadonlyArray<number> {
  const from = curve.from[axis]
  const control = curve.control[axis]
  const to = curve.to[axis]
  const denominator = from - 2 * control + to

  // a straight run has no turning point, and solving for one would divide by zero
  if (denominator === 0) {
    return [from, to]
  }

  const t = (from - control) / denominator

  if (t <= 0 || t >= 1) {
    return [from, to]
  }

  return [from, to, valueAt(from, control, to, t)]
}

/** The same curves as a path, for the one icon that is emitted as markup rather than drawn */
export const MARK_PATH = CURVES.map((curve, index) => {
  const previous = CURVES[index - 1]
  const continues = previous?.to[0] === curve.from[0] && previous?.to[1] === curve.from[1]
  const move = continues ? '' : `M${curve.from[0]},${curve.from[1]} `

  return `${move}Q${curve.control[0]},${curve.control[1]} ${curve.to[0]},${curve.to[1]}`
}).join(' ')

export const STROKE_WIDTH = 6

/**
 * How much of the canvas the mark spans across its widest point.
 *
 * Bounded by the circle a launcher crops a maskable icon to, which is 80% of the side: the mark
 * is wide and flat, so its ends are the corners of the widest box that still fits, and anything
 * past 0.73 loses them on a phone that crops.
 */
const FILL = 0.64

const ACROSS = CURVES.flatMap((curve) => extentOf(curve, 0))
const DOWN = CURVES.flatMap((curve) => extentOf(curve, 1))

/** Where the stroked mark actually reaches, extrema of the curves plus the round caps. */
const DRAWN = {
  left: Math.min(...ACROSS) - STROKE_WIDTH / 2,
  right: Math.max(...ACROSS) + STROKE_WIDTH / 2,
  top: Math.min(...DOWN) - STROKE_WIDTH / 2,
  bottom: Math.max(...DOWN) + STROKE_WIDTH / 2,
}

/** A line the stroke is measured against, in canvas coordinates. */
export interface Segment {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

export interface Mark {
  /** The curves flattened into lines, which is what a distance is taken from */
  readonly segments: ReadonlyArray<Segment>
  /** Half the stroke width, the distance from the centre line the paint reaches */
  readonly reach: number
  /** Where paint is possible at all, so a pixel outside it needs no distance taken */
  readonly bounds: {
    readonly left: number
    readonly right: number
    readonly top: number
    readonly bottom: number
  }
  /** The same placement as a transform, for the icon that is emitted as markup */
  readonly transform: { readonly scale: number; readonly x: number; readonly y: number }
}

// Flat enough that the error against the real curve is well under a hundredth of a pixel at the
// largest size emitted, which is smaller than the antialiasing can express.
const STEPS = 48

/**
 * Returns a point on a quadratic curve.
 * @param {Curve} curve - Curve to walk
 * @param {number} t - Position along it, 0 to 1
 * @returns {[number, number]} - The point
 */
function pointAt(curve: Curve, t: number): [number, number] {
  return [
    valueAt(curve.from[0], curve.control[0], curve.to[0], t),
    valueAt(curve.from[1], curve.control[1], curve.to[1], t),
  ]
}

/**
 * Places the mark on the canvas: scaled so its painted width is the share of the canvas the
 * layout asks for, centred on what is actually drawn rather than on the box the curves are
 * declared in, and flattened into the lines a rasteriser measures against.
 * @returns {Mark} - The placed mark
 */
export function placeMark(): Mark {
  const width = DRAWN.right - DRAWN.left
  const height = DRAWN.bottom - DRAWN.top
  const scale = (CANVAS * FILL) / width

  const offsetX = (CANVAS - width * scale) / 2 - DRAWN.left * scale
  const offsetY = (CANVAS - height * scale) / 2 - DRAWN.top * scale

  const segments: Segment[] = []

  for (const curve of CURVES) {
    let [previousX, previousY] = pointAt(curve, 0)

    for (let step = 1; step <= STEPS; step += 1) {
      const [x, y] = pointAt(curve, step / STEPS)

      segments.push({
        x1: previousX * scale + offsetX,
        y1: previousY * scale + offsetY,
        x2: x * scale + offsetX,
        y2: y * scale + offsetY,
      })

      previousX = x
      previousY = y
    }
  }

  const reach = (STROKE_WIDTH / 2) * scale

  return {
    segments,
    reach,
    bounds: {
      left: DRAWN.left * scale + offsetX,
      right: DRAWN.right * scale + offsetX,
      top: DRAWN.top * scale + offsetY,
      bottom: DRAWN.bottom * scale + offsetY,
    },
    transform: { scale, x: offsetX, y: offsetY },
  }
}
