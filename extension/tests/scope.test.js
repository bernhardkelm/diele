import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadScripts } from './load.js'

const scripts = loadScripts(['history/scope.js'])

/**
 * Copies a value out of the scripts' realm, so deep comparisons do not trip over its prototypes.
 * @param {unknown} value - Value made inside the context
 * @returns {unknown} - The same data, made here
 */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

test('an https instance at the root is matched on its whole origin', () => {
  assert.deepEqual(plain(scripts.historyScopeOf('https://diele.example.com/')), {
    url: 'https://diele.example.com/',
    origin: 'https://diele.example.com',
    path: '/',
    matches: ['https://diele.example.com/*'],
    permission: 'https://diele.example.com/*',
  })
})

test('an instance under a path is matched there and below, never beside it', () => {
  const scope = scripts.historyScopeOf('https://example.com:8443/portal')

  assert.deepEqual(plain(scope.matches), [
    'https://example.com:8443/portal',
    'https://example.com:8443/portal/*',
    'https://example.com:8443/portal?*',
  ])
  assert.equal(scope.permission, 'https://example.com:8443/*')
  assert.equal(scripts.isInHistoryScope('https://example.com:8443/portal/#/admin', scope), true)
  assert.equal(scripts.isInHistoryScope('https://example.com:8443/portal', scope), true)
  assert.equal(scripts.isInHistoryScope('https://example.com:8443/portalx', scope), false)
  assert.equal(scripts.isInHistoryScope('https://example.com/portal/', scope), false)
  assert.equal(scripts.isInHistoryScope('not a url', scope), false)
})

test('plain http is refused except on this machine', () => {
  assert.equal(scripts.historyScopeOf('http://diele.lan/'), undefined)
  assert.equal(scripts.historyScopeOf('http://192.168.1.10/'), undefined)
  assert.equal(
    scripts.historyScopeOf('http://localhost:5173/').permission,
    'http://localhost:5173/*',
  )
  assert.equal(scripts.historyScopeOf('http://127.0.0.1:3000/').url, 'http://127.0.0.1:3000/')
})

// Firefox refuses a match pattern with a port, so there it covers the host and the worker's own
// origin check keeps the relay to the one port
test('in Firefox the patterns drop the port, the scope itself keeps it', () => {
  const firefox = loadScripts(['history/scope.js'], {
    browser: { runtime: { getBrowserInfo: async () => ({ name: 'Firefox' }) } },
  })
  const scope = firefox.historyScopeOf('https://example.com:8443/portal/')

  assert.equal(firefox.historyPatternPorts(), false)
  assert.equal(scripts.historyPatternPorts(), true)
  assert.deepEqual(plain(scope.matches), ['https://example.com/portal/*'])
  assert.equal(scope.permission, 'https://example.com/*')
  assert.equal(scope.url, 'https://example.com:8443/portal/')
  assert.equal(firefox.isInHistoryScope('https://example.com/portal/', scope), false)
  assert.equal(firefox.historyScopeOf('http://localhost:5173/').permission, 'http://localhost/*')
})
