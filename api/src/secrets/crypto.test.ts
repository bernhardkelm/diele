import assert from 'node:assert/strict'
import { test } from 'node:test'
import { config } from '#config.js'
import { openSecret, sealSecret } from './crypto.js'

const SCOPE = { connectorId: 1, key: 'token' }

test('a sealed secret opens back to what went in', () => {
  const sealed = sealSecret('glpat-example-token', SCOPE)

  assert.notEqual(sealed.ciphertext.toString('utf8'), 'glpat-example-token')
  assert.equal(sealed.keyId, config.secrets.activeKeyId)
  assert.equal(openSecret(sealed, SCOPE), 'glpat-example-token')
})

test('opening with a key that is not configured throws rather than returning garbage', () => {
  const sealed = sealSecret('glpat-example-token', SCOPE)

  assert.throws(
    () => openSecret({ ...sealed, keyId: 'retired' }, SCOPE),
    /sealed with key "retired"/,
  )
})

test('ciphertext moved to another connector does not open', () => {
  const sealed = sealSecret('glpat-example-token', SCOPE)

  assert.throws(() => openSecret(sealed, { connectorId: 2, key: 'token' }))
  assert.throws(() => openSecret(sealed, { connectorId: 1, key: 'other' }))
})

test('altered ciphertext does not open', () => {
  const sealed = sealSecret('glpat-example-token', SCOPE)
  const tampered = Buffer.from(sealed.ciphertext)
  tampered[0] = (tampered[0]! + 1) % 256

  assert.throws(() => openSecret({ ...sealed, ciphertext: tampered }, SCOPE))
})

test('two seals of one value differ, so the iv is not reused', () => {
  const first = sealSecret('glpat-example-token', SCOPE)
  const second = sealSecret('glpat-example-token', SCOPE)

  assert.notEqual(first.iv.toString('hex'), second.iv.toString('hex'))
  assert.notEqual(first.ciphertext.toString('hex'), second.ciphertext.toString('hex'))
})
