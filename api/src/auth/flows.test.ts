import assert from 'node:assert/strict'
import { test } from 'node:test'
import { beginFlow, consumeFlow } from '#auth/flows.js'
import { getDb } from '#db/index.js'

const flow = {
  codeVerifier: 'verifier-value',
  nonce: 'nonce-value',
  redirectTo: '/settings',
  remember: true,
}

test('a handshake comes back as it went in', () => {
  beginFlow('state-roundtrip', flow)

  assert.deepEqual(consumeFlow('state-roundtrip'), flow)
})

// Single use whether or not the exchange that follows succeeds, so a replayed callback finds
// nothing to work with.
test('a handshake is consumed on first read, so a replay finds nothing', () => {
  beginFlow('state-once', flow)

  assert.ok(consumeFlow('state-once'))
  assert.equal(consumeFlow('state-once'), undefined)
})

test('a state nobody began is unknown', () => {
  assert.equal(consumeFlow('state-never-started'), undefined)
})

// The choice is made before the trip to the issuer and has to survive it.
test('remember and the return target survive the round trip', () => {
  beginFlow('state-plain', { ...flow, redirectTo: null, remember: false })

  const read = consumeFlow('state-plain')

  assert.equal(read?.remember, false)
  assert.equal(read?.redirectTo, null)
})

test('an expired handshake is refused and removed', () => {
  beginFlow('state-expired', flow)

  getDb()
    .prepare(`UPDATE auth_flows SET expires_at = datetime('now', '-1 minute') WHERE state = ?`)
    .run('state-expired')

  assert.equal(consumeFlow('state-expired'), undefined)

  const remaining = getDb()
    .prepare('SELECT COUNT(*) AS count FROM auth_flows WHERE state = ?')
    .get('state-expired') as { count: number }

  // Removed even though it was never handed back, so an expired row does not accumulate.
  assert.equal(remaining.count, 0)
})
