import { Buffer } from 'node:buffer'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { messageOf, redactSecrets } from '#connectors/redact.js'

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

test('an ordinary error is its own message', () => {
  assert.equal(messageOf(new Error('the token was rejected (401)')), 'the token was rejected (401)')
})

// Every transport failure arrives as the same `fetch failed`, so without the code a refused port,
// a wrong scheme and an unresolvable host are one message.
test('a transport failure carries the code fetch buried in its cause', () => {
  const error = new Error('fetch failed', {
    cause: Object.assign(new Error(''), { code: 'ECONNREFUSED' }),
  })

  assert.equal(messageOf(error), 'fetch failed (ECONNREFUSED)')
})

// OpenSSL's own message runs to several lines, and this one goes into a form field.
test('only the code is taken, not the reason it came wrapped in', () => {
  const reason = Object.assign(new Error('error:0A00010B:SSL routines:\nwrong version number'), {
    code: 'ERR_SSL_WRONG_VERSION_NUMBER',
  })

  assert.equal(
    messageOf(new Error('fetch failed', { cause: reason })),
    'fetch failed (ERR_SSL_WRONG_VERSION_NUMBER)',
  )
})

test('a cause carrying no code leaves the message as it was', () => {
  assert.equal(messageOf(new Error('fetch failed', { cause: new Error('why') })), 'fetch failed')
})

test('something thrown that is not an error is read as text', () => {
  assert.equal(messageOf('plain string'), 'plain string')
})
