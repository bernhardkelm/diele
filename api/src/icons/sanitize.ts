import { DOMParser, XMLSerializer, type Element, type Node } from '@xmldom/xmldom'
import { badRequest } from '#errors.js'

// Allowlists, not denylists. An uploaded icon is inlined into the portal's own page, so it
// runs in the portal's origin if anything executable survives; enumerating what is safe is
// the only posture that stays correct as SVG grows new features.
const ELEMENTS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'rect',
  'defs',
  'symbol',
  'use',
  'title',
  'desc',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'text',
  'tspan',
])

const ATTRIBUTES = new Set([
  'viewBox',
  'xmlns',
  'width',
  'height',
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'points',
  'transform',
  'fill',
  'fill-rule',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-opacity',
  'opacity',
  'clip-path',
  'clip-rule',
  'mask',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientUnits',
  'gradientTransform',
  'patternUnits',
  'id',
  'role',
  'aria-hidden',
  'font-size',
  'font-family',
  'text-anchor',
  'dominant-baseline',
])

// `id` is allowed so internal references keep working, and `href` only in the fragment form
// that points at one. Anything absolute would fetch, which an icon has no business doing.
const FRAGMENT_ONLY = new Set(['href', 'xlink:href', 'clip-path', 'mask', 'fill', 'stroke'])

const MAX_BYTES = 64 * 1024

/**
 * Returns whether a value references something outside the document.
 * @param {string} value - Attribute value to test
 * @returns {boolean} - True when it points anywhere but an internal fragment
 */
function isExternalReference(value: string): boolean {
  const trimmed = value.trim().toLowerCase()
  if (trimmed.startsWith('url(')) {
    return !trimmed.startsWith('url(#')
  }

  // A bare fragment is fine; a protocol-relative url or anything carrying a scheme is not. The
  // scheme is matched as a shape rather than by name, so `javascript:` and whatever a browser
  // grows next are covered without keeping a list.
  return trimmed.startsWith('//') || /^[a-z][a-z0-9+.-]*:/.test(trimmed)
}

/**
 * Rewrites a paint value so the icon takes the colour of the text around it, which is what
 * makes a tile monochrome at rest and brand-coloured on hover. `none` is meaningful and
 * survives: it is the difference between an unfilled outline and a filled shape.
 * @param {string} value - Original fill or stroke value
 * @returns {string} - `none`, an internal reference, or `currentColor`
 */
function toCurrentColor(value: string): string {
  const trimmed = value.trim().toLowerCase()
  if (trimmed === 'none' || trimmed === 'transparent') {
    return 'none'
  }

  // gradients and patterns are internal references, and recolouring them would flatten them
  if (trimmed.startsWith('url(#')) {
    return value
  }

  return 'currentColor'
}

/**
 * Strips an element and its subtree of everything not on the allowlists, and rewrites its
 * paint so it inherits the surrounding colour.
 * @param {Element} element - Element to clean, in place
 * @returns {void}
 */
function clean(element: Element): void {
  // snapshot first: removing an attribute mutates the live list being walked
  const attributes = Array.from({ length: element.attributes.length }, (_, index) =>
    element.attributes.item(index),
  ).filter((attribute): attribute is NonNullable<typeof attribute> => attribute !== null)

  for (const attribute of attributes) {
    const name = attribute.name
    const value = attribute.value

    // event handlers are the obvious vector, and none of them are ever wanted
    if (name.toLowerCase().startsWith('on')) {
      element.removeAttribute(name)
      continue
    }

    if (name === 'href' || name === 'xlink:href') {
      if (isExternalReference(value) || !value.trim().startsWith('#')) {
        element.removeAttribute(name)
      }
      continue
    }

    // `style` can carry its own url() and is not worth parsing when the attributes above
    // already express everything an icon needs
    if (name === 'style' || name === 'class' || !ATTRIBUTES.has(name)) {
      element.removeAttribute(name)
      continue
    }

    if (FRAGMENT_ONLY.has(name) && isExternalReference(value)) {
      element.removeAttribute(name)
      continue
    }

    if (name === 'fill' || name === 'stroke') {
      element.setAttribute(name, toCurrentColor(value))
    }
  }

  const children = Array.from({ length: element.childNodes.length }, (_, index) =>
    element.childNodes.item(index),
  ).filter((child): child is Node => child !== null)

  for (const child of children) {
    if (child.nodeType === 1) {
      const asElement = child as Element
      if (!ELEMENTS.has(asElement.tagName)) {
        element.removeChild(child)
        continue
      }

      clean(asElement)
      continue
    }

    // Comments and processing instructions carry nothing an icon needs. A CDATA section carries
    // nothing either, and leaving one in is what lets markup through: this parses as xml, the
    // portal inlines the result as html, and the html parser reads `<![CDATA[` as a bogus comment
    // that ends at the first `>`, so whatever follows becomes live markup.
    if (child.nodeType === 8 || child.nodeType === 7 || child.nodeType === 4) {
      element.removeChild(child)
    }
  }
}

/**
 * Parses an uploaded SVG, strips everything that is not a shape, and rewrites its paint so it
 * inherits `currentColor` the way the portal's own logos do.
 * @param {string} source - Raw SVG markup as uploaded
 * @returns {string} - Sanitised markup, safe to inline into the portal's page
 */
export function sanitizeSvg(source: string): string {
  if (source.length > MAX_BYTES) {
    throw badRequest(`svg is larger than ${MAX_BYTES / 1024}kb`)
  }

  // A DOCTYPE is how entity-expansion attacks arrive, and an icon never needs one.
  if (/<!DOCTYPE/i.test(source) || /<!ENTITY/i.test(source)) {
    throw badRequest('svg must not declare a doctype or entities')
  }

  let document
  try {
    document = new DOMParser({
      onError: (level, message) => {
        if (level === 'fatalError') {
          throw badRequest(`svg could not be parsed: ${message}`)
        }
      },
    }).parseFromString(source, 'image/svg+xml')
  } catch (error) {
    throw error instanceof Error && error.name === 'ApiError'
      ? error
      : badRequest('svg could not be parsed')
  }

  const root = document.documentElement
  if (!root || root.tagName !== 'svg') {
    throw badRequest('file must be an svg')
  }

  clean(root)

  // The card sizes the icon itself, so a fixed width and height would fight it; the viewBox
  // is what carries the shape's proportions.
  root.removeAttribute('width')
  root.removeAttribute('height')

  if (!root.getAttribute('viewBox')) {
    throw badRequest('svg needs a viewBox, otherwise it cannot be scaled')
  }

  const markup = new XMLSerializer().serializeToString(root)
  if (!markup.includes('<svg')) {
    throw badRequest('svg could not be serialised')
  }

  return markup
}
