import type { ApiBrand } from '@diele/common'
import { encodeIco } from './ico.js'
import {
  CANVAS,
  MARK_PATH,
  PAGE_DARK,
  PLATE,
  PLATE_RADIUS,
  placeMark,
  STROKE_WIDTH,
} from './mark.js'
import { encodePng } from './png.js'
import { renderIcon } from './raster.js'

/** One file the browser can ask for, already encoded. */
export interface FaviconAsset {
  readonly body: Buffer
  readonly type: string
}

/** The sides packed into `favicon.ico`, which is asked for by things that never read a document */
const ICO_SIZES = [16, 32, 48]

/** What the tab and the bookmark bar draw, where the rounding is ours to apply */
const BROWSER_SIZE = 96

/** What iOS puts on a home screen. Square: the phone rounds it itself */
const APPLE_SIZE = 180

/** What a manifest declares, the two sides an installed app is drawn from */
const MANIFEST_SIZES = [192, 512]

/**
 * Draws and encodes one PNG.
 * @param {number} size - Side in pixels
 * @param {number} radius - Corner rounding in canvas units, zero for a square
 * @param {string} accent - Colour of the mark
 * @returns {Buffer} - The encoded file
 */
function png(size: number, radius: number, accent: string): Buffer {
  return encodePng(renderIcon({ size, radius, plate: PLATE, accent }), size)
}

/**
 * Writes the mark as markup, which is what a browser scales instead of picking a raster from.
 * @param {string} accent - Colour of the mark
 * @returns {string} - The svg
 */
function svg(accent: string): string {
  const { transform } = placeMark()
  const place = `translate(${transform.x.toFixed(3)} ${transform.y.toFixed(3)}) scale(${transform.scale.toFixed(4)})`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="${CANVAS}" height="${CANVAS}">`,
    `<rect width="${CANVAS}" height="${CANVAS}" rx="${PLATE_RADIUS}" fill="${PLATE}"/>`,
    `<g transform="${place}">`,
    `<path d="${MARK_PATH}" fill="none" stroke="${accent}" stroke-width="${STROKE_WIDTH}" stroke-linecap="round"/>`,
    '</g>',
    '</svg>',
  ].join('')
}

/**
 * Writes the manifest an installed app is described by.
 * @param {ApiBrand} brand - Wordmark and accents this deployment is configured with
 * @returns {string} - The manifest
 */
function manifest(brand: ApiBrand): string {
  return JSON.stringify(
    {
      // What a launcher matches an installed app against, rather than the `start_url` it falls
      // back to, so moving that url later updates the app instead of installing a second one.
      id: '/',
      name: brand.title,
      short_name: brand.title,
      // Chrome treats a manifest without `start_url` as not installable, so the icons below are
      // drawn for a prompt that never appears. The portal is served from the root either way.
      start_url: '/',
      scope: '/',
      icons: MANIFEST_SIZES.map((size) => ({
        src: `/favicon/web-app-manifest-${size}x${size}.png`,
        sizes: `${size}x${size}`,
        type: 'image/png',
        // Both, because the icon is a full square: a launcher that masks it loses nothing, and
        // one that does not is left with the shape as drawn rather than a circle inside a box.
        purpose: 'any maskable',
      })),
      theme_color: PAGE_DARK,
      background_color: PAGE_DARK,
      display: 'standalone',
    },
    null,
    2,
  )
}

/**
 * Draws the whole icon set from the configured accent, once.
 *
 * Generated rather than committed because the accent is a setting: a portal painted in someone
 * else's colour would otherwise carry the stock mark on every tab, home screen and bookmark, in
 * the one place a colour is meant to say whose portal this is.
 *
 * The dark accent throughout, because every icon here sits on the dark plate whatever the page
 * behind the browser is set to.
 * @param {ApiBrand} brand - Wordmark and accents this deployment is configured with
 * @returns {ReadonlyMap<string, FaviconAsset>} - Assets by the path they are served under
 */
export function buildFavicons(brand: ApiBrand): ReadonlyMap<string, FaviconAsset> {
  const accent = brand.accentDark

  const assets = new Map<string, FaviconAsset>([
    ['/favicon/favicon.svg', { body: Buffer.from(svg(accent), 'utf8'), type: 'image/svg+xml' }],
    [
      '/favicon/favicon.ico',
      {
        body: encodeIco(ICO_SIZES.map((size) => ({ size, png: png(size, PLATE_RADIUS, accent) }))),
        type: 'image/x-icon',
      },
    ],
    [
      `/favicon/favicon-${BROWSER_SIZE}x${BROWSER_SIZE}.png`,
      { body: png(BROWSER_SIZE, PLATE_RADIUS, accent), type: 'image/png' },
    ],
    ['/favicon/apple-touch-icon.png', { body: png(APPLE_SIZE, 0, accent), type: 'image/png' }],
    [
      '/favicon/site.webmanifest',
      { body: Buffer.from(manifest(brand), 'utf8'), type: 'application/manifest+json' },
    ],
  ])

  for (const size of MANIFEST_SIZES) {
    assets.set(`/favicon/web-app-manifest-${size}x${size}.png`, {
      body: png(size, 0, accent),
      type: 'image/png',
    })
  }

  return assets
}
