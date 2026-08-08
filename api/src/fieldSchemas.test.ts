import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hexColor, httpUrl, isHttpUrl, queryTemplate, reorderSchema } from '#fieldSchemas.js'

test('an absolute http(s) url is accepted', () => {
  assert.equal(isHttpUrl('https://example.com'), true)
  assert.equal(isHttpUrl('http://localhost:5173/path?q=1#x'), true)
})

// The reason this check exists: these values are handed to the browser to open, so a scheme
// that runs code would put a script behind a click on the portal's own page.
test('a scheme that is not http(s) is refused', () => {
  for (const value of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ]) {
    assert.equal(isHttpUrl(value), false, value)
  }
})

test('a relative or unparseable url is refused, since it has no scheme to check', () => {
  for (const value of ['', '/path', 'example.com', '//example.com', 'not a url']) {
    assert.equal(isHttpUrl(value), false, value)
  }
})

test('the url schema trims and then applies the same rule', () => {
  assert.equal(httpUrl.parse('  https://example.com  '), 'https://example.com')
  assert.equal(httpUrl.safeParse('javascript:alert(1)').success, false)
  assert.equal(httpUrl.safeParse('').success, false)
})

test('a template has to say where the term goes', () => {
  assert.equal(queryTemplate.safeParse('https://example.com/search?q={query}').success, true)
  assert.equal(queryTemplate.safeParse('https://example.com/search').success, false)
})

// Checked after substitution, so a template that only becomes a url once the term is in it is
// still rejected for the scheme rather than passing on its placeholder.
test('a template is a url once the placeholder is filled, and only an http(s) one', () => {
  assert.equal(queryTemplate.safeParse('javascript:search({query})').success, false)
  assert.equal(queryTemplate.safeParse('/search?q={query}').success, false)
})

test('a colour is a six-digit hex and nothing else', () => {
  assert.equal(hexColor.parse('#1E88E5'), '#1E88E5')
  assert.equal(hexColor.parse('  #1e88e5  '), '#1e88e5')

  for (const value of ['#abc', '1e88e5', 'red', '#1e88e5; background: url(x)']) {
    assert.equal(hexColor.safeParse(value).success, false, value)
  }
})

test('a reorder body is a non-empty list of positive integer ids', () => {
  assert.deepEqual(reorderSchema.parse({ ids: [3, 1, 2] }).ids, [3, 1, 2])

  for (const body of [
    { ids: [] },
    { ids: [0] },
    { ids: [-1] },
    { ids: [1.5] },
    { ids: ['1'] },
    {},
  ]) {
    assert.equal(reorderSchema.safeParse(body).success, false, JSON.stringify(body))
  }
})
