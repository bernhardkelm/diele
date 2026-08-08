import assert from 'node:assert/strict'
import { test } from 'node:test'
import { safeRedirect } from '#auth/routes.js'

test('a path inside the portal is kept, query and fragment included', () => {
  assert.equal(safeRedirect('/'), '/')
  assert.equal(safeRedirect('/settings'), '/settings')
  assert.equal(safeRedirect('/admin?tab=cards#top'), '/admin?tab=cards#top')
})

// This value arrives on a public endpoint, so honouring an absolute one would turn login into
// an open redirect.
test('anything that leaves the origin is discarded rather than corrected', () => {
  for (const raw of [
    'https://evil.example',
    'http://evil.example/path',
    '//evil.example',
    '/\\evil.example',
    'settings',
    '',
  ]) {
    assert.equal(safeRedirect(raw), '/', JSON.stringify(raw))
  }
})

test('a value that is not a string at all lands on the portal root', () => {
  for (const raw of [undefined, null, 42, true, ['/settings'], { path: '/settings' }]) {
    assert.equal(safeRedirect(raw), '/', JSON.stringify(raw))
  }
})

// A browser strips these before resolving the url, so a tab inside the path reaches it as
// `//evil.com` while every textual check above reads it as a same-origin path.
test('a path carrying a control character is refused', () => {
  for (const raw of ['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '/\u0000/evil.com']) {
    assert.equal(safeRedirect(raw), '/', JSON.stringify(raw))
  }
})

test('an ordinary path with punctuation is still allowed through', () => {
  assert.equal(safeRedirect('/admin?tab=links#row-3'), '/admin?tab=links#row-3')
})
