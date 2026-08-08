import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { ApiCommand } from '@diele/common'
import { startApi, type TestApi } from '#testing/harness.js'

type Row = ApiCommand & { enabled: boolean; readonly?: boolean }

let api: TestApi
// Read after startApi: a static import of the repository pulls `config` in with it, and the
// harness would then be handed an environment it can no longer change.
let builtIns: ReadonlyArray<{ keyword: string; label: string }>

/**
 * Adds a command and hands back the stored row.
 * @param {string} keyword - What follows the slash
 * @param {Record<string, unknown>} overrides - Fields to set on top of a minimal valid command
 * @returns {Promise<ApiCommand>} - The created command
 */
async function command(
  keyword: string,
  overrides: Record<string, unknown> = {},
): Promise<ApiCommand> {
  const body = {
    keyword,
    urlTemplate: `https://example.test/${keyword}?q={query}`,
    ...overrides,
  }

  const { command: created } = await api.post<{ command: ApiCommand }>('/api/admin/commands', body)

  return created
}

before(async () => {
  api = await startApi({ AUTH_MODE: 'dev' })
  await api.signIn()
  builtIns = (await import('#commands/repository.js')).BUILT_IN_COMMANDS
})

after(async () => {
  await api.close()
})

// Both kinds in one list, so a keyword collision is visible before it is saved.
test('the built-ins lead the list and are marked read-only', async () => {
  const { rows } = await api.get<{ rows: Row[] }>('/api/admin/commands')
  const leading = rows.slice(0, builtIns.length)

  assert.deepEqual(
    leading.map((row) => row.keyword),
    builtIns.map((entry) => entry.keyword),
  )

  for (const row of leading) {
    assert.equal(row.readonly, true, row.keyword)
    assert.equal(row.urlTemplate, null)
    assert.ok(row.id < 0, 'a built-in has no row, so it cannot carry a real id')
  }
})

test('a created command comes back with its ref', async () => {
  const created = await command('yt', { label: 'YouTube' })

  assert.equal(created.keyword, 'yt')
  assert.equal(created.label, 'YouTube')
  assert.equal(created.ref, `cmd:${created.id}`)
})

test('a keyword is lowercased and trimmed on the way in', async () => {
  const created = await command('  MixedCase  ')

  assert.equal(created.keyword, 'mixedcase')
})

// A command that shadowed /admin would leave a portal with no way back into its own settings.
test('a built-in keyword cannot be redefined', async () => {
  for (const keyword of builtIns.map((entry) => entry.keyword)) {
    const response = await api.request('/api/admin/commands', {
      method: 'POST',
      body: JSON.stringify({ keyword, urlTemplate: 'https://evil.test/?q={query}' }),
    })

    assert.equal(response.status, 400, keyword)
    const body = (await response.json()) as { error: string }
    assert.match(body.error, /built in/)
  }
})

test('a duplicate keyword is refused as a bad request rather than surfacing as a database error', async () => {
  await command('dupe')

  const response = await api.request('/api/admin/commands', {
    method: 'POST',
    body: JSON.stringify({ keyword: 'dupe', urlTemplate: 'https://other.test/?q={query}' }),
  })

  assert.equal(response.status, 400)
  const body = (await response.json()) as { error: string }
  assert.match(body.error, /already defined/)
})

// `/r/vuejs` has to stay a subreddit jump rather than being read as a command called `r/vuejs`.
test('a keyword with a slash or a space is refused', async () => {
  for (const keyword of ['r/vuejs', 'two words', '/leading', '-dash', '.dot', '']) {
    const response = await api.request('/api/admin/commands', {
      method: 'POST',
      body: JSON.stringify({ keyword, urlTemplate: 'https://example.test/?q={query}' }),
    })

    assert.equal(response.status, 400, JSON.stringify(keyword))
  }
})

test('a template has to say where the term goes and has to be http(s)', async () => {
  for (const urlTemplate of [
    'https://example.test/search',
    'javascript:go({query})',
    '/search?q={query}',
  ]) {
    const response = await api.request('/api/admin/commands', {
      method: 'POST',
      body: JSON.stringify({ keyword: `t${Math.abs(urlTemplate.length)}`, urlTemplate }),
    })

    assert.equal(response.status, 400, urlTemplate)
  }
})

test('a patch can rename a command, and cannot rename it onto a built-in', async () => {
  const created = await command('rename-me')

  const renamed = await api
    .request(`/api/admin/commands/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ keyword: 'renamed' }),
    })
    .then((r) => r.json() as Promise<{ command: ApiCommand }>)
  assert.equal(renamed.command.keyword, 'renamed')

  const onto = await api.request(`/api/admin/commands/${created.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ keyword: 'admin' }),
  })
  assert.equal(onto.status, 400)
})

test('a patch onto an existing keyword is refused', async () => {
  await command('taken')
  const other = await command('free')

  const response = await api.request(`/api/admin/commands/${other.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ keyword: 'taken' }),
  })

  assert.equal(response.status, 400)
})

test('patching a command that is not there answers 404', async () => {
  const response = await api.request('/api/admin/commands/999999', {
    method: 'PATCH',
    body: JSON.stringify({ label: 'x' }),
  })

  assert.equal(response.status, 404)
})

test('a disabled command stays in the admin list and leaves the portal', async () => {
  const created = await command('toggled')

  await api.request(`/api/admin/commands/${created.id}/enabled`, {
    method: 'PUT',
    body: JSON.stringify({ enabled: false }),
  })

  const { rows } = await api.get<{ rows: Row[] }>('/api/admin/commands')
  assert.equal(rows.find((row) => row.id === created.id)?.enabled, false)

  const portal = await api.get<{ commands: ApiCommand[] }>('/api/config')
  assert.equal(
    portal.commands.some((entry) => entry.id === created.id),
    false,
  )
})

test('reordering and deleting behave like the other ordered lists', async () => {
  const a = await command('ord-a')
  const b = await command('ord-b')

  assert.equal(
    (
      await api.request('/api/admin/commands/order', {
        method: 'PUT',
        body: JSON.stringify({ ids: [b.id, a.id] }),
      })
    ).status,
    200,
  )

  const { rows } = await api.get<{ rows: Row[] }>('/api/admin/commands')
  const at = (id: number): number => rows.findIndex((row) => row.id === id)
  assert.ok(at(b.id) < at(a.id))

  assert.equal((await api.request(`/api/admin/commands/${a.id}`, { method: 'DELETE' })).status, 200)
  assert.equal((await api.request(`/api/admin/commands/${a.id}`, { method: 'DELETE' })).status, 404)
})
