import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { ApiBrand } from '@diele/common'
import {
  documentPolicy,
  hashSource,
  inlineHashes,
  TRUSTED_TYPES_POLICY,
} from '#site/contentSecurityPolicy.js'
import { injectRuntime } from '#site/indexMeta.js'

const WEB_INDEX = readFileSync(join(import.meta.dirname, '../../../web/index.html'), 'utf8')
const SVG_DIRECTIVE = readFileSync(
  join(import.meta.dirname, '../../../web/src/directives/trustedSvg.ts'),
  'utf8',
)

const BRAND: ApiBrand = {
  title: 'acme',
  subtitle: 'start page',
  accentLight: '#16a34a',
  accentDark: '#22c55e',
}

/**
 * Splits a policy into its directives, keyed by name.
 * @param {string} policy - Header value
 * @returns {Map<string, string[]>} - Sources per directive
 */
function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(';').map((directive) => {
      const [name = '', ...sources] = directive.trim().split(/\s+/)
      return [name, sources]
    }),
  )
}

/**
 * Hashes a script body independently of the module under test, as a browser would.
 * @param {string} source - Script text
 * @returns {string} - A `'sha256-…'` source expression
 */
function expectedHash(source: string): string {
  return `'sha256-${createHash('sha256').update(source).digest('base64')}'`
}

/**
 * Cuts the one inline script out of a document by position rather than by the pattern the
 * module uses, so a pattern that matched the wrong span would not agree with itself here.
 * @param {string} html - Document carrying exactly one inline script
 * @returns {string} - Its text content
 */
function inlineScriptOf(html: string): string {
  const open = '<script>'
  const start = html.indexOf(open)
  assert.notEqual(start, -1, 'no inline script in the document')

  return html.slice(start + open.length, html.indexOf('</script>', start))
}

test('the policy allows the inline script web/index.html actually carries', () => {
  const served = injectRuntime(WEB_INDEX, { brand: BRAND, version: '1.2.3' })
  const scriptSources = directives(documentPolicy(served, false)).get('script-src')

  assert.deepEqual(scriptSources, ["'self'", expectedHash(inlineScriptOf(WEB_INDEX))])
})

// The hash is taken after the brand is stamped in, so stamping must leave the script alone; if
// it ever added inline code, that code would need a hash of its own.
test('stamping the brand neither touches the inline script nor adds inline code', () => {
  const served = injectRuntime(WEB_INDEX, { brand: BRAND, version: '1.2.3' })

  assert.equal(inlineScriptOf(served), inlineScriptOf(WEB_INDEX))
  assert.deepEqual(inlineHashes(served, 'script'), inlineHashes(WEB_INDEX, 'script'))
  assert.deepEqual(inlineHashes(served, 'style'), [])
})

test('editing the inline script moves the hash with it', () => {
  const edited = WEB_INDEX.replace("'diele:theme'", "'diele:theme-v2'")
  assert.notEqual(edited, WEB_INDEX)

  const before = directives(documentPolicy(WEB_INDEX, false)).get('script-src')
  const after = directives(documentPolicy(edited, false)).get('script-src')

  assert.notDeepEqual(after, before)
  assert.deepEqual(after, ["'self'", expectedHash(inlineScriptOf(edited))])
})

test('a script loaded by src is left to self rather than hashed', () => {
  const html = '<script type="module" crossorigin src="/assets/index-abc.js"></script>'

  assert.deepEqual(inlineHashes(html, 'script'), [])
})

test('an inline style is hashed into style-src', () => {
  const html = '<style>body{color:red}</style>'
  const styleSources = directives(documentPolicy(html, false)).get('style-src')

  assert.deepEqual(styleSources, ["'self'", expectedHash('body{color:red}')])
})

// The html parser normalises line endings before the browser hashes, so a checkout with CRLF
// would otherwise be served a hash for text the browser never sees.
test('line endings are hashed the way the browser reads them', () => {
  assert.equal(hashSource('a\r\nb\rc\n'), expectedHash('a\nb\nc\n'))
})

test('the document may not be framed, embed plugins, or move its base', () => {
  const policy = directives(documentPolicy(WEB_INDEX, false))

  assert.deepEqual(policy.get('default-src'), ["'none'"])
  assert.deepEqual(policy.get('frame-ancestors'), ["'none'"])
  assert.deepEqual(policy.get('object-src'), ["'none'"])
  assert.deepEqual(policy.get('base-uri'), ["'none'"])
  assert.deepEqual(policy.get('form-action'), ["'self'"])
})

// Pinned whole, so a source added anywhere fails here until it is also written down in the
// readme. The loopback probe is the one request the browser makes anywhere but this origin.
test('the policy allows exactly the sources diele loads from', () => {
  assert.deepEqual(
    directives(documentPolicy(WEB_INDEX, true)),
    new Map([
      ['default-src', ["'none'"]],
      ['script-src', ["'self'", expectedHash(inlineScriptOf(WEB_INDEX))]],
      ['style-src', ["'self'"]],
      ['img-src', ["'self'"]],
      ['font-src', ["'self'"]],
      ['manifest-src', ["'self'"]],
      [
        'connect-src',
        [
          "'self'",
          'http://localhost:*',
          'https://localhost:*',
          'http://127.0.0.1:*',
          'https://127.0.0.1:*',
        ],
      ],
      ['object-src', ["'none'"]],
      ['base-uri', ["'none'"]],
      ['form-action', ["'self'"]],
      ['frame-ancestors', ["'none'"]],
    ]),
  )
})

test('no source is a wildcard, a scheme of its own, or unsafe', () => {
  for (const [name, sources] of directives(documentPolicy(WEB_INDEX, true))) {
    for (const source of sources) {
      assert.doesNotMatch(source, /^'unsafe-|^\*$|^(https?|data|blob):$/, `${name} ${source}`)
    }
  }
})

// Most portals probe nothing on this machine, and there the page may not reach it at all.
test('a page that probes no loopback port may connect to its own origin only', () => {
  assert.deepEqual(directives(documentPolicy(WEB_INDEX, false)).get('connect-src'), ["'self'"])
})

// The header names the policy the web app creates, so a rename on either side alone would leave
// every icon reported, and later refused.
test('trusted types allows the policy the web app actually creates, and vue', () => {
  const name = /export const SVG_POLICY_NAME = '([^']+)'/.exec(SVG_DIRECTIVE)?.[1]
  assert.ok(name, 'no SVG_POLICY_NAME in web/src/directives/trustedSvg.ts')

  assert.equal(
    TRUSTED_TYPES_POLICY,
    `require-trusted-types-for 'script'; trusted-types ${name} vue`,
  )
  assert.doesNotMatch(TRUSTED_TYPES_POLICY, /allow-duplicates|\*/)
})
