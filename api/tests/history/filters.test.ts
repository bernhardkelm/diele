import assert from 'node:assert/strict'
import { test } from 'node:test'
import { acceptVisit, type VisitFilter } from '#history/filters.js'

const FILTER: VisitFilter = {
  ownOrigin: 'https://portal.example.com',
  engineTemplates: ['https://search.example.com/find?term={query}'],
  excludedDomains: ['bank.example', 'private.test'],
}

test('an ordinary page is kept in stored form', () => {
  assert.equal(
    acceptVisit('https://grafana.example.com/d/abc/overview?orgId=1', FILTER),
    'https://grafana.example.com/d/abc/overview',
  )
})

test('every kind of visit not worth keeping is dropped', () => {
  for (const raw of [
    'mailto:someone@example.com',
    'https://portal.example.com/admin',
    'http://localhost:5173/',
    'http://127.0.0.1:3000/x',
    'http://[::1]/',
    'http://localhost./',
    'http://0.0.0.0:8080/',
    'http://[::ffff:7f00:1]/',
    'http://169.254.169.254/latest/meta-data',
    'http://198.18.0.1/',
    'http://[2001:db8::1]/',
    'http://[::ffff:0:7f00:1]/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'https://www.google.com/maps/search/somewhere',
    'https://app.example/invite/a1b2c3d4e5',
    'https://app.example/reset;token=Xk9fQ2mZ7pL4wR8tY1vB6nC3hJ5sD0gA/Xk9fQ2mZ7pL4wR8tY1vB6nC3hJ5sD0gA',
    'https://portal.example.com./settings',
    'https://bank.example./accounts',
    'https://www.google.com/search?q=secret+diagnosis',
    'https://search.example.com/find?term=x',
    'https://app.example.com/reset/Xk9fQ2mZ7pL4wR8tY1vB6nC3hJ5sD0gA',
    'https://bank.example/accounts',
    'https://online.bank.example/accounts',
    'https://private.test/',
    `https://example.com/${'a'.repeat(2100)}`,
  ]) {
    assert.equal(acceptVisit(raw, FILTER), undefined, raw)
  }
})

// The query is what tells a search page apart, so the check runs before anything is stripped.
test('a search page is recognised by its query, and the same path without one is kept', () => {
  assert.equal(acceptVisit('https://github.com/search?q=diele', FILTER), undefined)
  assert.equal(acceptVisit('https://github.com/search', FILTER), 'https://github.com/search')
})

test('a session riding in a matrix parameter is stripped rather than kept', () => {
  assert.equal(
    acceptVisit('https://shop.example/cart;jsessionid=0123456789ABCDEF', FILTER),
    'https://shop.example/cart',
  )
})

test('a portal served on another port of the same host is not its own origin', () => {
  assert.equal(
    acceptVisit('https://portal.example.com:8443/', FILTER),
    'https://portal.example.com:8443/',
  )
})
