import { createHash } from 'node:crypto'

export const CSP_HEADER = 'Content-Security-Policy'
export const CSP_REPORT_ONLY_HEADER = 'Content-Security-Policy-Report-Only'

/**
 * Trusted Types for the document, reported rather than enforced until a release shows no
 * violations. `diele-svg` is web/src/directives/trustedSvg.ts, the one way markup reaches
 * `innerHTML`, and `vue` is the policy Vue's runtime creates for itself on load.
 */
export const TRUSTED_TYPES_POLICY =
  "require-trusted-types-for 'script'; trusted-types diele-svg vue"

/**
 * What every response but the document carries. None of them is meant to render as a page, so
 * one opened directly, an svg icon or a json body, may load nothing and be framed by nobody.
 */
export const RESOURCE_POLICY = "default-src 'none'; frame-ancestors 'none'"

// Where the browser probes saved sites and local ports (web/src/helpers/localhost.ts). Any port
// rather than the configured ones: the document is served ahead of the session gate, so listing
// them would publish them to anyone, and a port added in the admin panel, which is this same page,
// would stay blocked until a reload. `[::1]` is missing because a CSP source cannot name an ipv6
// literal, so a probe there is refused and reads as nothing answering.
const LOCAL_PROBES = [
  'http://localhost:*',
  'https://localhost:*',
  'http://127.0.0.1:*',
  'https://127.0.0.1:*',
]

// `<script>` and `<style>` with their content, attributes captured to tell an inline one from a
// `src` reference. A regex rather than a parser: the document is the one vite emitted, not input.
const INLINE_ELEMENT = {
  script: /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
  style: /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi,
} as const

/**
 * Hashes a block of inline code the way a browser does before comparing it with the policy.
 * @param {string} source - Text content of the element, exactly as served
 * @returns {string} - A `'sha256-…'` source expression
 */
export function hashSource(source: string): string {
  // The html parser turns CRLF and lone CR into LF before the hash is taken, so a checkout with
  // windows line endings must hash what the browser sees rather than what is on disk.
  const normalised = source.replace(/\r\n?/g, '\n')

  return `'sha256-${createHash('sha256').update(normalised, 'utf8').digest('base64')}'`
}

/**
 * Collects the hash of every inline element of one kind in a document. An element carrying
 * `src` is a reference rather than inline code and is covered by `'self'` instead.
 * @param {string} html - The document as it is served
 * @param {keyof typeof INLINE_ELEMENT} tag - Which element to look for
 * @returns {string[]} - One source expression per distinct inline element, in document order
 */
export function inlineHashes(html: string, tag: keyof typeof INLINE_ELEMENT): string[] {
  const hashes = new Set<string>()

  for (const match of html.matchAll(INLINE_ELEMENT[tag])) {
    const [, attributes = '', content = ''] = match
    if (/\bsrc\s*=/i.test(attributes)) {
      continue
    }

    hashes.add(hashSource(content))
  }

  return [...hashes]
}

/**
 * Builds the policy the document is served under, allowing the inline code it carries by hash.
 *
 * Deny by default, then one directive per kind of thing the built app loads, each limited to
 * this origin. Taken from the document actually served, so an edit to its inline script moves
 * the hash with it rather than leaving the page blocked by a constant nobody updated.
 * @param {string} html - The document as it is served, after the brand is stamped in
 * @param {boolean} probesLoopback - Whether the page will probe ports on this machine
 * @returns {string} - Header value for `Content-Security-Policy`
 */
export function documentPolicy(html: string, probesLoopback: boolean): string {
  const directives: Array<[string, ...string[]]> = [
    ['default-src', "'none'"],
    ['script-src', "'self'", ...inlineHashes(html, 'script')],
    // Vue writes `:style` bindings through the CSSOM, which `style-src-attr` does not govern, and
    // the icon sanitiser strips `style` attributes, so no attribute needs `'unsafe-inline'`.
    ['style-src', "'self'", ...inlineHashes(html, 'style')],
    ['img-src', "'self'"],
    ['font-src', "'self'"],
    ['manifest-src', "'self'"],
    ['connect-src', "'self'", ...(probesLoopback ? LOCAL_PROBES : [])],
    ['object-src', "'none'"],
    ['base-uri', "'none'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
  ]

  return directives.map((sources) => sources.join(' ')).join('; ')
}
