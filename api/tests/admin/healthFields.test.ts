import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { ApiFeature, ApiFieldSpec } from '@diele/common'
import { startApi, type TestApi } from '#tests/support/harness.js'
import type { DB } from '#db/index.js'

let api: TestApi
let db: DB

const METRICS = [
  '# HELP monitor_status the status',
  'monitor_status{monitor_name="nextcloud",monitor_url="https://cloud.test"} 1',
  'monitor_status{monitor_name="Alertmanager",monitor_url="https://alerts.test"} 0',
  'monitor_status{monitor_name="nextcloud",monitor_url="https://cloud.test"} 1',
  '',
].join('\n')

/**
 * Writes a Kuma connector straight into the database, so no source has to answer to create one.
 * @param {string} label - Name to tell it apart by
 * @param {string} baseUrl - Instance the row points at
 * @returns {number} - Its id
 */
function seedKuma(label: string, baseUrl: string): number {
  const { id } = db
    .prepare(
      `INSERT INTO connectors (type, label, config, sync_interval_s, position, enabled)
       VALUES ('uptime-kuma', ?, ?, 900, 1000, 1) RETURNING id`,
    )
    .get(label, JSON.stringify({ baseUrl })) as { id: number }

  // Opened the way `createConnector` opens it, since that is where a run's state is recorded
  db.prepare('INSERT INTO connector_sync (connector_id) VALUES (?)').run(id)

  return id
}

/**
 * Answers a Kuma origin from the test, leaving every other request to the real fetch so the
 * harness can still talk to the app it started.
 * @param {(url: string) => Response | undefined} answer - What a matching url gets
 * @returns {() => void} - Puts the real fetch back
 */
function interceptFetch(answer: (url: string) => Response | undefined): () => void {
  const real = globalThis.fetch

  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    const answered = answer(String(input))

    return answered ? Promise.resolve(answered) : real(input as Parameters<typeof real>[0], init)
  }) as typeof fetch

  return () => {
    globalThis.fetch = real
  }
}

/**
 * Reads the liveness selector a feature carries for one connector instance.
 * @param {string} featureId - Feature whose form to read
 * @param {string} provider - Option value the selector is shown for
 * @returns {Promise<ApiFieldSpec | undefined>} - The selector, or undefined when there is none
 */
async function selectorFor(featureId: string, provider: string): Promise<ApiFieldSpec | undefined> {
  const { features } = await api.get<{ features: ApiFeature[] }>('/api/admin/features')
  const feature = features.find((entry) => entry.id === featureId)

  return feature?.fields.find(
    (field) => field.key === 'healthMonitor' && field.showWhen?.value.includes(provider),
  )
}

before(async () => {
  api = await startApi({ AUTH_MODE: 'dev' })
  await api.signIn()
  db = (await import('#db/index.js')).getDb()
})

after(async () => {
  await api.close()
})

// Typing a monitor name to the letter is the one part of binding an entry that nothing checks
// until the dot fails to appear, so the names are offered rather than asked for.
test('an instance that can list its monitors offers them as a dropdown', async () => {
  const id = seedKuma('listing', 'https://uptime-listing.test')
  const restore = interceptFetch((url) =>
    url.startsWith('https://uptime-listing.test') ? new Response(METRICS) : undefined,
  )

  try {
    const field = await selectorFor('cards', `uptime-kuma:${id}`)

    assert.ok(field)
    assert.equal(field.input, 'select')
    assert.deepEqual(
      field.options?.map((option) => option.value),
      ['', 'Alertmanager', 'nextcloud'],
    )
  } finally {
    restore()
  }
})

// The first option is what a blank box used to mean, and it is still the best answer for most
// entries: a monitor tends to be named after the host it watches.
test('matching automatically stays the first choice', async () => {
  const id = seedKuma('automatic', 'https://uptime-automatic.test')
  const restore = interceptFetch((url) =>
    url.startsWith('https://uptime-automatic.test') ? new Response(METRICS) : undefined,
  )

  try {
    const field = await selectorFor('cards', `uptime-kuma:${id}`)

    assert.equal(field?.options?.[0]?.value, '')
    assert.match(String(field?.options?.[0]?.label), /automatic/i)
  } finally {
    restore()
  }
})

// An instance that cannot be reached for a moment must not take binding with it: the typed box
// is what it always was, and a name entered there still resolves.
test('an instance that cannot answer falls back to the typed box', async () => {
  const id = seedKuma('unreachable', 'https://uptime-unreachable.test')
  const restore = interceptFetch((url) =>
    url.startsWith('https://uptime-unreachable.test')
      ? new Response('nope', { status: 500 })
      : undefined,
  )

  try {
    const field = await selectorFor('cards', `uptime-kuma:${id}`)

    assert.ok(field)
    assert.equal(field.input, 'text')
    assert.equal(field.options, undefined)
  } finally {
    restore()
  }
})

// Two instances watch different things, so one dropdown for the pair would offer names half of
// it has never heard of.
test('each instance carries its own list', async () => {
  const listed = seedKuma('one', 'https://uptime-one.test')
  const other = seedKuma('two', 'https://uptime-two.test')
  const restore = interceptFetch((url) => {
    if (url.startsWith('https://uptime-one.test')) {
      return new Response(METRICS)
    }

    if (url.startsWith('https://uptime-two.test')) {
      return new Response('monitor_status{monitor_name="only-here"} 1\n')
    }

    return undefined
  })

  try {
    const first = await selectorFor('cards', `uptime-kuma:${listed}`)
    const second = await selectorFor('cards', `uptime-kuma:${other}`)

    assert.deepEqual(
      second?.options?.map((option) => option.value),
      ['', 'only-here'],
    )
    assert.equal(
      first?.options?.some((option) => option.value === 'only-here'),
      false,
    )
  } finally {
    restore()
  }
})

// PromQL is not enumerable, so the box stays a box.
test('a source with no list to give keeps its typed field', async () => {
  const { id } = db
    .prepare(
      `INSERT INTO connectors (type, label, config, sync_interval_s, position, enabled)
       VALUES ('prometheus', 'metrics', ?, 900, 1000, 1) RETURNING id`,
    )
    .get(JSON.stringify({ baseUrl: 'https://prom.test' })) as { id: number }

  const { features } = await api.get<{ features: ApiFeature[] }>('/api/admin/features')
  const field = features
    .find((entry) => entry.id === 'cards')
    ?.fields.find(
      (entry) => entry.key === 'healthQuery' && entry.showWhen?.value.includes(`prometheus:${id}`),
    )

  assert.ok(field)
  assert.equal(field.input, 'text')
})

// Nothing else reaches a decorator that has yet to be bound to anything, so a connector pointed
// at an address that does not answer would otherwise read as merely unused.
test('an instance that could not be listed is marked as failing on its own row', async () => {
  const id = seedKuma('records', 'https://uptime-records.test')
  const restore = interceptFetch((url) =>
    url.startsWith('https://uptime-records.test')
      ? new Response('nope', { status: 503 })
      : undefined,
  )

  try {
    await api.get('/api/admin/features')

    const row = db
      .prepare('SELECT last_error FROM connector_sync WHERE connector_id = ?')
      .get(id) as { last_error: string | null }

    assert.match(String(row.last_error), /503/)
  } finally {
    restore()
  }
})
