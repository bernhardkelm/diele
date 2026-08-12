import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ApiBrand } from '@diele/common'
import { injectRuntime } from '#site/indexMeta.js'

const PLACEHOLDER = '<!--diele:brand-->'
const DOCUMENT = `<!doctype html><head><title>diele</title>${PLACEHOLDER}</head>`

const BRAND: ApiBrand = {
  title: 'acme',
  subtitle: 'start page',
  accentLight: '#16a34a',
  accentDark: '#22c55e',
}

/**
 * Reads a meta's content back out of a stamped document, as a browser would.
 * @param {string} html - Document to read
 * @param {string} name - Meta name to look for
 * @returns {string} - Its content with the entities resolved
 */
function metaContent(html: string, name: string): string {
  // `[^"]*` deliberately: an escape that failed would end the attribute early and this would
  // match a truncated value rather than the whole one.
  const match = new RegExp(`<meta name="${name}" content="([^"]*)">`).exec(html)
  assert.ok(match, `no ${name} meta in the document`)

  return match[1]!
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

test('the brand and the version are stamped where the placeholder was', () => {
  const html = injectRuntime(DOCUMENT, { brand: BRAND, version: '1.2.3' })

  assert.equal(html.includes(PLACEHOLDER), false)
  assert.deepEqual(JSON.parse(metaContent(html, 'diele:brand')), BRAND)
  assert.equal(metaContent(html, 'diele:version'), '1.2.3')
})

// Safari reads neither the manifest nor the wordmark for the label under a home-screen icon, so
// a deployment that is not stamped here is one whose icon carries the project's name.
test('the ios home-screen label is the configured title', () => {
  const html = injectRuntime(DOCUMENT, { brand: BRAND, version: '1.2.3' })

  assert.equal(metaContent(html, 'apple-mobile-web-app-title'), 'acme')
})

// The wordmark is whatever the environment said, and it lands in an attribute in the document
// the portal is served as. A quote that closed it early would put the rest of it in markup.
test('a wordmark that carries markup cannot break out of its attribute', () => {
  const brand: ApiBrand = { ...BRAND, title: `"><script>alert(1)</script>` }
  const html = injectRuntime(DOCUMENT, { brand, version: '1.2.3' })

  assert.equal(html.includes('<script>'), false)
  assert.equal(JSON.parse(metaContent(html, 'diele:brand')).title, brand.title)
})

// `$&` and its siblings are substitutions to `String.replace`, so a wordmark carrying one would
// otherwise be replaced by the placeholder it was standing in for.
test('a wordmark that carries a replacement pattern is written as typed', () => {
  const brand: ApiBrand = { ...BRAND, title: 'Rock $& Roll' }
  const html = injectRuntime(DOCUMENT, { brand, version: "$'" })

  assert.equal(JSON.parse(metaContent(html, 'diele:brand')).title, 'Rock $& Roll')
  assert.equal(metaContent(html, 'diele:version'), "$'")
})

// Which is what a build predating the placeholder looks like: it is served as it is rather than
// refused, and the app falls back to what it can read for itself.
test('a document without the placeholder comes back unchanged', () => {
  const plain = '<!doctype html><head><title>diele</title></head>'

  assert.equal(injectRuntime(plain, { brand: BRAND, version: '1.2.3' }), plain)
})
