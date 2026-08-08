import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loginSchema, normaliseUsername, setupSchema } from '#auth/schemas.js'

// One form everywhere: the value stored, the value looked up, and the key the rate limiter
// counts against. Two spellings becoming two limiter buckets against one account is the bug
// this prevents.
test('a username reduces to one form', () => {
  assert.equal(normaliseUsername('  Admin  '), 'admin')
  assert.equal(normaliseUsername('ADMIN'), 'admin')
  assert.equal(normaliseUsername('admin'), 'admin')
})

test('a login normalises the username before anything else sees it', () => {
  const parsed = loginSchema.parse({ username: '  Ada.Lovelace ', password: 'x' })

  assert.equal(parsed.username, 'ada.lovelace')
  assert.equal(parsed.remember, false)
})

test('remember is carried when asked for and defaults off', () => {
  assert.equal(loginSchema.parse({ username: 'ada', password: 'x', remember: true }).remember, true)
  assert.equal(loginSchema.parse({ username: 'ada', password: 'x' }).remember, false)
})

// Not length-checked at login: the rule belongs to setup, and applying it here would tell a
// caller that a short password cannot be the right one for this account.
test('a login accepts any non-empty password', () => {
  assert.equal(loginSchema.safeParse({ username: 'ada', password: 'short' }).success, true)
  assert.equal(loginSchema.safeParse({ username: 'ada', password: '' }).success, false)
})

test('a username has to be a word, which is what the NOCASE index can actually keep unique', () => {
  for (const username of ['ab', 'a b', 'ada lovelace', '.ada', '-ada', 'ada/lovelace', 'adá', '']) {
    assert.equal(
      setupSchema.safeParse({ username, password: 'a'.repeat(12), token: 't' }).success,
      false,
      username,
    )
  }

  for (const username of ['ada', 'ada.lovelace', 'ada_lovelace', 'ada-1', 'a1b']) {
    assert.equal(
      setupSchema.safeParse({ username, password: 'a'.repeat(12), token: 't' }).success,
      true,
      username,
    )
  }
})

test('setup demands twelve characters and a token', () => {
  assert.equal(
    setupSchema.safeParse({ username: 'ada', password: 'a'.repeat(11), token: 't' }).success,
    false,
  )
  assert.equal(
    setupSchema.safeParse({ username: 'ada', password: 'a'.repeat(12), token: '' }).success,
    false,
  )
  assert.equal(setupSchema.safeParse({ username: 'ada', password: 'a'.repeat(12) }).success, false)
})

// Only bounds the work one request can ask the hash to do; the body limit alone would let a
// megabyte of input through.
test('a password is bounded above as well as below', () => {
  assert.equal(
    setupSchema.safeParse({ username: 'ada', password: 'a'.repeat(256), token: 't' }).success,
    true,
  )
  assert.equal(
    setupSchema.safeParse({ username: 'ada', password: 'a'.repeat(257), token: 't' }).success,
    false,
  )
})
