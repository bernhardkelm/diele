import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeSegment, hasTokenSegment, isTokenSegment } from '#history/tokens.js'

// Every shape a person returns to and expects offered back.
test('the pages people revisit are kept', () => {
  for (const path of [
    '/d/nErXDvCkzz/kubernetes-overview-dashboard',
    '/d/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d/node-exporter-full',
    '/bernhardkelm/diele/pull/27',
    '/bernhardkelm/diele/blob/main/api/src/history/tokens.ts',
    '/browse/ABC-123',
    '/wiki/spaces/ENG/pages/123456789/Kubernetes+Overview+Dashboard+For+The+Platform+Team',
    '/wiki/spaces/ENG/pages/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    '/acme/Quarterly-Planning-Notes-0123456789abcdef0123456789abcdef',
    '/acme/0123456789abcdef0123456789abcdef',
    '/blog/nodejs-v24-7-0-release-notes-and-changelog',
    '/docs/internationalization-and-localization',
    '/Donaudampfschifffahrtsgesellschaft',
    '/orders/12345678901234567890',
    '/wiki/MyVeryLongCamelCasePageName',
  ]) {
    assert.equal(hasTokenSegment(path), false, path)
  }
})

// A key to an account, kept in a list the search offers back.
test('links that carry a secret in their path are refused', () => {
  for (const path of [
    '/reset/Xk9fQ2mZ7pL4wR8tY1vB6nC3hJ5sD0gA',
    '/reset/Xk9fQ2mZ7pL4wR8tY1vB6nC3hJ5sD0gAqW3eRt',
    '/auth/magic/aGVsbG8td29ybGQtdGhpcy1pcy1hLXRva2Vu',
    '/s/8f14e45fceea167a5a36dedd4bea2543c7f3a9b1',
    '/share/v1-Hq7Lm2Zx9Kp4Wn8Rt3Yb6Vc1Fd5Gs0Jh',
    '/login/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
  ]) {
    assert.equal(hasTokenSegment(path), true, path)
  }
})

test('a short segment is never a token, however random it looks', () => {
  assert.equal(isTokenSegment('x7Kq9Zp2Lm4W'), false)
})

test('a percent-encoded segment is judged on what it decodes to', () => {
  assert.equal(isTokenSegment('Kubernetes%20Overview%20Dashboard'), false)
  assert.equal(isTokenSegment('%E0%A4%A'), false)
})

// Encoded a second time to slip past a filter that decodes once.
test('a segment is decoded twice before it is judged, and no further', () => {
  assert.equal(decodeSegment('%252e'), '.')
  assert.equal(decodeSegment('%25252e'), '%2e')
  assert.equal(decodeSegment('%E0%A4%A'), '%E0%A4%A')
})

test('a random run of letters alone, with almost no vowels, is a token', () => {
  assert.equal(isTokenSegment('xKqZpLmWbTrVnCdFgHjS'), true)
})
