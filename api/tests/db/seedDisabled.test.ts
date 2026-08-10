import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { ApiConfig } from '@diele/common'
import { startApi, type TestApi } from '#tests/support/harness.js'

let api: TestApi

before(async () => {
  api = await startApi({ AUTH_MODE: 'dev', DIELE_SEED_STOCK_CONFIG: 'false' })
  await api.signIn()
})

after(async () => {
  await api.close()
})

// The way back to the database this portal used to create: a deployment that would rather start
// from its own export gets nothing it has to delete first.
test('a portal told not to seed is created with nothing in it', async () => {
  const payload = await api.get<ApiConfig>('/api/config')

  assert.deepEqual(payload.engines, [])
  assert.deepEqual(payload.commands, [])
  assert.deepEqual(payload.localhost, [])
})

test('the admin list has nothing to show either, built-ins aside', async () => {
  const engines = await api.get<{ rows: unknown[] }>('/api/admin/engines')
  const ports = await api.get<{ rows: unknown[] }>('/api/admin/localhost')
  const commands = await api.get<{ rows: Array<{ id: number }> }>('/api/admin/commands')

  assert.deepEqual(engines.rows, [])
  assert.deepEqual(ports.rows, [])
  assert.equal(
    commands.rows.every((row) => row.id < 0),
    true,
    'a command row was stored despite seeding being off',
  )
})
