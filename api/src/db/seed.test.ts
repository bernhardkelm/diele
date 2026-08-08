import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { ApiCommand, ApiConfig } from '@diele/common'
import { startApi, type TestApi } from '#testing/harness.js'

interface AdminRow {
  id: number
  enabled: boolean
}

let api: TestApi
let STOCK: typeof import('#db/stockConfig.js')

before(async () => {
  // The harness turns seeding off for every other file, because a test owns its tables. This is
  // the one that asks for it back.
  api = await startApi({ AUTH_MODE: 'dev', DIELE_SEED_STOCK_CONFIG: 'true' })
  await api.signIn()
  STOCK = await import('#db/stockConfig.js')
})

after(async () => {
  await api.close()
})

test('a fresh portal can search without anything being typed in', async () => {
  const payload = await api.get<ApiConfig>('/api/config')
  const enabled = STOCK.STOCK_ENGINES.filter((engine) => engine.enabled)

  assert.deepEqual(
    payload.engines.map((engine) => engine.name),
    enabled.map((engine) => engine.name),
  )
  // The first is what `↵` submits to, so which one leads is the portal's default and not a detail.
  assert.equal(payload.engines[0]?.name, 'DuckDuckGo')
})

// Off is what most of them are, so the switched-off ones must reach the database without reaching
// the portal: the admin list is where they are discovered.
test('the engines that ship off are stored but not served', async () => {
  const { rows } = await api.get<{ rows: AdminRow[] }>('/api/admin/engines')

  assert.equal(rows.length, STOCK.STOCK_ENGINES.length)
  assert.equal(
    rows.filter((row) => row.enabled).length,
    STOCK.STOCK_ENGINES.filter((engine) => engine.enabled).length,
  )
})

test('a fresh portal answers the commands that ship on, and only those', async () => {
  const payload = await api.get<ApiConfig>('/api/config')

  assert.deepEqual(
    payload.commands.map((command) => command.keyword),
    STOCK.STOCK_COMMANDS.filter((command) => command.enabled).map((command) => command.keyword),
  )
})

test('every stock command is in the admin list, on or off', async () => {
  const { rows } = await api.get<{ rows: Array<ApiCommand & AdminRow> }>('/api/admin/commands')
  // Built-ins are listed alongside the rows without being any, and carry a negative id.
  const stored = rows.filter((row) => row.id > 0)

  assert.deepEqual(
    stored.map((row) => row.keyword),
    STOCK.STOCK_COMMANDS.map((command) => command.keyword),
  )
})

// The rows are on while the feature is off, so switching local ports on is one action rather than
// four. Nothing is probed until then.
test('the local ports are waiting behind a feature that is still off', async () => {
  const { rows } = await api.get<{ rows: AdminRow[] }>('/api/admin/localhost')
  const payload = await api.get<ApiConfig>('/api/config')

  assert.equal(rows.length, STOCK.STOCK_PORTS.length)
  assert.equal(
    rows.every((row) => row.enabled),
    true,
  )
  assert.deepEqual(payload.localhost, [])
})

// The line the seed does not cross: a card or a saved site would be a guess at an address only
// this deployment knows, which is what the empty database was protecting.
test('nothing was invented that only this deployment could know', async () => {
  const payload = await api.get<ApiConfig>('/api/config')

  assert.deepEqual(payload.cards, [])
  assert.deepEqual(payload.sites, [])
})
