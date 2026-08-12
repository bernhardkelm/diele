import type { ApiBrand } from '@diele/common'
import { PAGE_DARK, PAGE_LIGHT } from '#favicon/mark.js'

/** The comment `web/index.html` carries, so neither side may rename it alone. */
const PLACEHOLDER = '<!--diele:brand-->'

export const BRAND_META_NAME = 'diele:brand'
export const VERSION_META_NAME = 'diele:version'

export interface StampedRuntime {
  readonly brand: ApiBrand
  /** What `/status` reports, carried here so the footer needs no request of its own */
  readonly version: string
}

/**
 * Escapes a value for an HTML attribute. The accents are hex by the time they get here, but the
 * wordmark, its subtitle and the version are whatever the environment said, and they are about
 * to be written into the document the portal is served as.
 * @param {string} value - Raw text to write into an attribute
 * @returns {string} - The same text, safe between double quotes
 */
function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Writes what this deployment is into the served document, so the page has it before it has
 * asked anyone anything.
 *
 * The brand is what the login screen paints in: it is the one screen with no cached
 * configuration to start from, since signing out is what clears it, and it would otherwise show
 * the built-in defaults until the providers endpoint answered. Everything behind the gate keeps
 * reading the cache and is untouched by this.
 *
 * The theme colour is stamped here as well, one per scheme, because it is what a phone paints
 * the bar above the page with and the page under it is painted from the same two values.
 *
 * The iOS home-screen label likewise: Safari reads neither the manifest nor the wordmark for it,
 * so the one place the configured title can reach that icon is a meta in this document.
 *
 * A document without the placeholder comes back unchanged, which is the case for a build that
 * predates it.
 * @param {string} html - The built index.html
 * @param {StampedRuntime} runtime - What to stamp into it
 * @returns {string} - The same document, carrying the brand and the version
 */
export function injectRuntime(html: string, runtime: StampedRuntime): string {
  const tags = [
    `<meta name="${BRAND_META_NAME}" content="${escapeAttribute(JSON.stringify(runtime.brand))}">`,
    `<meta name="${VERSION_META_NAME}" content="${escapeAttribute(runtime.version)}">`,
    `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${PAGE_LIGHT}">`,
    `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${PAGE_DARK}">`,
    `<meta name="apple-mobile-web-app-title" content="${escapeAttribute(runtime.brand.title)}">`,
  ].join('\n    ')

  // A replacer function rather than the string itself: `$&` and its siblings are substitutions
  // to `replace`, and a wordmark is free text that may contain one.
  return html.replace(PLACEHOLDER, () => tags)
}
