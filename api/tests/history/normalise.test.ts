import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isOnDomain, normaliseDomain } from '#history/domains.js'
import { MAX_URL_LENGTH, normaliseUrl, originOf } from '#history/normalise.js'

// The query and fragment are where tokens, sessions and search terms ride, so only the origin and
// the path are ever stored.
test('a url is kept as its origin and path, nothing else', () => {
  assert.equal(
    normaliseUrl('https://grafana.example.com/d/abc/overview?orgId=1&from=now-6h#panel-2'),
    'https://grafana.example.com/d/abc/overview',
  )
})

test('credentials in a url are never stored', () => {
  assert.equal(
    normaliseUrl('https://alice:hunter2@nas.example.com/files'),
    'https://nas.example.com/files',
  )
})

test('the host is lowercased and a default port dropped, a different one kept', () => {
  assert.equal(normaliseUrl('HTTPS://Wiki.Example.COM:443/Page'), 'https://wiki.example.com/Page')
  assert.equal(normaliseUrl('http://example.com:80/'), 'http://example.com/')
  assert.equal(normaliseUrl('http://example.com:8080/x'), 'http://example.com:8080/x')
})

// One entry per page, whichever way the link to it was written.
test('a trailing slash is dropped everywhere but the root', () => {
  assert.equal(normaliseUrl('https://example.com/docs/'), 'https://example.com/docs')
  assert.equal(normaliseUrl('https://example.com/docs'), 'https://example.com/docs')
  assert.equal(normaliseUrl('https://example.com'), 'https://example.com/')
  assert.equal(normaliseUrl('https://example.com/'), 'https://example.com/')
})

test('anything that is not a web page is refused', () => {
  for (const raw of [
    'ftp://example.com/',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'not a url',
    '',
  ]) {
    assert.equal(normaliseUrl(raw), undefined, raw)
  }
})

test('a url longer than anyone opens on purpose is refused', () => {
  const base = 'https://example.com/'
  assert.equal(
    normaliseUrl(`${base}${'a'.repeat(MAX_URL_LENGTH - base.length)}`)?.length,
    MAX_URL_LENGTH,
  )
  assert.equal(normaliseUrl(`${base}${'a'.repeat(MAX_URL_LENGTH)}`), undefined)
})

test('the origin of a stored url is its root', () => {
  assert.equal(originOf('https://www.youtube.com/watch'), 'https://www.youtube.com/')
})

// The parser keeps `;jsessionid=...` in the path, and a session id is exactly what must not be kept.
test('matrix parameters are stripped from every segment', () => {
  assert.equal(
    normaliseUrl('https://shop.example/cart;jsessionid=ABC123/item;token=xyz/view'),
    'https://shop.example/cart/item/view',
  )
})

test('a host written with its trailing dot is the same host', () => {
  assert.equal(normaliseUrl('https://example.com./docs'), 'https://example.com/docs')
})

test('a domain is reduced to a bare lowercase hostname', () => {
  assert.equal(normaliseDomain('  Example.COM '), 'example.com')
  assert.equal(normaliseDomain('https://bank.example.com/login?x=1'), 'bank.example.com')
  assert.equal(normaliseDomain('*.example.com'), 'example.com')
  assert.equal(normaliseDomain('.example.com.'), 'example.com')
  assert.equal(normaliseDomain('example.com:8443'), 'example.com')
  assert.equal(normaliseDomain('nas'), 'nas')
  assert.equal(normaliseDomain('bücher.de'), 'xn--bcher-kva.de')
})

test('what is not a hostname is refused', () => {
  for (const raw of [
    '',
    '   ',
    'exa mple.com',
    '-bad.com',
    'bad-.com',
    'a..b',
    'under_score.com',
    `${'a'.repeat(64)}.com`,
  ]) {
    assert.equal(normaliseDomain(raw), undefined, raw)
  }
})

test('a domain covers itself and its subdomains, never a lookalike', () => {
  assert.equal(isOnDomain('example.com', 'example.com'), true)
  assert.equal(isOnDomain('a.b.example.com', 'example.com'), true)
  assert.equal(isOnDomain('notexample.com', 'example.com'), false)
  assert.equal(isOnDomain('example.com.evil.test', 'example.com'), false)
})

// Encoded, the `;` reaches the server as a matrix separator all the same once it is decoded.
test('an encoded matrix parameter is stripped too, and what is kept is encoded again', () => {
  assert.equal(
    normaliseUrl('https://shop.example/path%3Bjsessionid%3D0123456789abcdef0123456789abcdef'),
    'https://shop.example/path',
  )
  assert.equal(
    normaliseUrl('https://shop.example/%253Bjsessionid%253D1/a'),
    'https://shop.example/a',
  )
  assert.equal(
    normaliseUrl('https://shop.example/caf%C3%A9%3Bv%3D1'),
    'https://shop.example/caf%C3%A9',
  )
})

test('a segment that was only matrix parameters leaves no empty segment behind', () => {
  assert.equal(normaliseUrl('https://shop.example/a/;jsessionid=1/b'), 'https://shop.example/a/b')
  assert.equal(
    normaliseUrl('https://shop.example/a/%3Bjsessionid%3D1/b'),
    'https://shop.example/a/b',
  )
  assert.equal(normaliseUrl('https://shop.example/;jsessionid=1'), 'https://shop.example/')
  assert.equal(
    normaliseUrl('https://example.com//double//slash'),
    'https://example.com/double/slash',
  )
})
