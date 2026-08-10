import { Buffer } from 'node:buffer'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { redactSecrets } from '#connectors/redact.js'

const TOKEN = 'glpat-a/b+c=example'
const SECRETS = { token: TOKEN }

test('a credential quoted back as entered is removed', () => {
  const redacted = redactSecrets(`401 for PRIVATE-TOKEN ${TOKEN}`, SECRETS)

  assert.ok(!redacted.includes(TOKEN))
  assert.ok(redacted.includes('[redacted]'))
})

test('a credential quoted back url encoded is removed', () => {
  const encoded = encodeURIComponent(TOKEN)
  const redacted = redactSecrets(`GET /api?private_token=${encoded} failed`, SECRETS)

  assert.ok(!redacted.includes(encoded))
  assert.ok(!redacted.includes(TOKEN))
})

test('a credential quoted back base64 is removed', () => {
  const base64 = Buffer.from(TOKEN, 'utf8').toString('base64')
  const redacted = redactSecrets(`Authorization: Bearer ${base64}`, SECRETS)

  assert.ok(!redacted.includes(base64))
})

test('every occurrence goes, not just the first', () => {
  const redacted = redactSecrets(`${TOKEN} then ${TOKEN}`, SECRETS)

  assert.ok(!redacted.includes(TOKEN))
  assert.equal(redacted, '[redacted] then [redacted]')
})

test('a value too short to be a credential is left alone, so prose survives', () => {
  const redacted = redactSecrets('the id is abc', { token: 'abc' })

  assert.equal(redacted, 'the id is abc')
})

test('text carrying no credential is returned as it came', () => {
  const redacted = redactSecrets('connection refused', SECRETS)

  assert.equal(redacted, 'connection refused')
})
