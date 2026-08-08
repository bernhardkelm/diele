import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hashPassword, spendDummyVerify, verifyPassword } from '#auth/password.js'

test('a password verifies against its own hash', async () => {
  const stored = await hashPassword('correct horse battery staple')

  assert.equal(await verifyPassword('correct horse battery staple', stored), true)
})

test('a wrong password does not', async () => {
  const stored = await hashPassword('correct horse battery staple')

  assert.equal(await verifyPassword('Correct horse battery staple', stored), false)
  assert.equal(await verifyPassword('', stored), false)
})

// The nonce is what makes this true, and it is what stops two accounts with the same password
// being visible as such in the table.
test('the same password hashes differently every time', async () => {
  const first = await hashPassword('a shared password')
  const second = await hashPassword('a shared password')

  assert.notEqual(first, second)
  assert.equal(await verifyPassword('a shared password', first), true)
  assert.equal(await verifyPassword('a shared password', second), true)
})

// The parameters travel with the hash so raising the cost later is a rehash on next login
// rather than a migration, which only works if they are actually written down.
test('the hash carries the algorithm and the cost it was made with', async () => {
  const stored = await hashPassword('a password')
  const [algorithm, version, cost, nonce, tag] = stored.split('$')

  assert.equal(algorithm, 'argon2id')
  assert.equal(version, 'v=19')
  assert.equal(cost, 'm=19456,t=2,p=1')
  assert.ok(nonce && nonce.length > 0)
  assert.ok(tag && tag.length > 0)
})

test('a hash written with other parameters still verifies, rather than the current ones being assumed', async () => {
  const stored = await hashPassword('a password')
  const weakened = stored.replace('m=19456,t=2,p=1', 'm=19456,t=3,p=1')

  // Re-derived with t=3 as the string says, which is not the tag that was stored with t=2.
  assert.equal(await verifyPassword('a password', weakened), false)
})

test('a stored value that is not a hash is refused rather than throwing', async () => {
  for (const stored of [
    '',
    'not-a-hash',
    'bcrypt$v=19$m=1,t=1,p=1$aaaa$bbbb',
    'argon2id$v=19$$aaaa$bbbb',
    'argon2id$v=19$m=19456,t=2,p=1$aaaa',
    'argon2id$v=19$m=x,t=y,p=z$aaaa$bbbb',
  ]) {
    assert.equal(await verifyPassword('a password', stored), false, stored)
  }
})

// Without this, an unknown username answers faster than a known one with a wrong password,
// which is enough to enumerate accounts.
test('the dummy verification spends real work and resolves either way', async () => {
  const started = process.hrtime.bigint()
  await spendDummyVerify('whatever was typed')
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6

  assert.ok(elapsedMs > 1, `expected real derivation work, took ${elapsedMs}ms`)
})
