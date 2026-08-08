import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { getDb } from '#db/index.js'
import { deleteSecret, listSecretKeys, readSecrets, writeSecret } from '#secrets/repository.js'

/**
 * Creates a connector row to hang credentials off, since the secrets table references one.
 * @param {string} label - Label, which is what makes the row identifiable in a test
 * @returns {number} - Its id
 */
function connector(label: string): number {
  const row = getDb()
    .prepare(
      `INSERT INTO connectors (type, label, config, sync_interval_s, position)
       VALUES ('gitlab', ?, '{}', 900, 1000) RETURNING id`,
    )
    .get(label) as { id: number }

  return row.id
}

test('a stored credential opens back to what went in', () => {
  const id = connector('roundtrip')

  writeSecret(id, 'token', 'glpat-abcdef')

  assert.deepEqual(readSecrets(id), { token: 'glpat-abcdef' })
})

test('writing the same key again replaces it rather than adding a second row', () => {
  const id = connector('replace')

  writeSecret(id, 'token', 'first')
  writeSecret(id, 'token', 'second')

  assert.deepEqual(readSecrets(id), { token: 'second' })
  assert.equal(listSecretKeys(id).length, 1)
})

// Clearing a field in the form is how a credential is removed.
test('writing an empty value deletes the credential', () => {
  const id = connector('cleared')

  writeSecret(id, 'token', 'glpat-abcdef')
  writeSecret(id, 'token', '')

  assert.deepEqual(readSecrets(id), {})
  assert.deepEqual(listSecretKeys(id), [])
})

test('the key listing says what is set and when, and never what it is', () => {
  const id = connector('listing')

  writeSecret(id, 'token', 'glpat-abcdef')
  writeSecret(id, 'webhook', 'https://hooks.example/secret')

  const keys = listSecretKeys(id)

  assert.deepEqual(
    keys.map((entry) => entry.key),
    ['token', 'webhook'],
  )
  assert.equal(JSON.stringify(keys).includes('glpat'), false)
  assert.equal(JSON.stringify(keys).includes('hooks.example'), false)

  for (const entry of keys) {
    assert.ok(entry.updatedAt.length > 0)
  }
})

test('deleting one credential leaves the others', () => {
  const id = connector('partial-delete')

  writeSecret(id, 'token', 'a')
  writeSecret(id, 'webhook', 'b')
  deleteSecret(id, 'token')

  assert.deepEqual(readSecrets(id), { webhook: 'b' })
})

test('one connector cannot read another connector credentials', () => {
  const mine = connector('mine')
  const yours = connector('yours')

  writeSecret(mine, 'token', 'mine-only')

  assert.deepEqual(readSecrets(yours), {})
})

// The connector id and key are the AAD the cipher binds to, so a row moved between connectors
// fails to open rather than handing the new owner someone else's token.
test('a credential moved to another connector does not open', () => {
  const source = connector('aad-source')
  const target = connector('aad-target')

  writeSecret(source, 'token', 'glpat-abcdef')

  getDb()
    .prepare('UPDATE connector_secrets SET connector_id = ? WHERE connector_id = ?')
    .run(target, source)

  const warn = mock.method(console, 'warn', () => {})
  const opened = readSecrets(target)
  const warnings = warn.mock.callCount()
  warn.mock.restore()

  assert.deepEqual(opened, {})
  assert.equal(warnings, 1)
})

// One credential sealed with a retired key must not take the others down with it.
test('a credential that cannot be opened is left out rather than failing the whole read', () => {
  const id = connector('mixed')

  writeSecret(id, 'good', 'readable')
  writeSecret(id, 'bad', 'unreadable')

  getDb()
    .prepare(
      `UPDATE connector_secrets SET key_id = 'retired' WHERE connector_id = ? AND key = 'bad'`,
    )
    .run(id)

  const warn = mock.method(console, 'warn', () => {})
  const opened = readSecrets(id)
  warn.mock.restore()

  assert.deepEqual(opened, { good: 'readable' })
})

test('deleting the connector takes its credentials with it', () => {
  const id = connector('cascade')

  writeSecret(id, 'token', 'glpat-abcdef')
  getDb().prepare('DELETE FROM connectors WHERE id = ?').run(id)

  assert.deepEqual(listSecretKeys(id), [])
})
