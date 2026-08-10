import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { ApiIcon } from '@diele/common'
import { startApi, type TestApi } from '#tests/support/harness.js'

interface EngineRow {
  id: number
  name: string
  urlTemplate: string
  position: number
  enabled: boolean
}

interface PortRow {
  id: number
  scheme: 'http' | 'https'
  port: number
  keywords: string[]
  enabled: boolean
}

let api: TestApi

before(async () => {
  api = await startApi({ AUTH_MODE: 'dev' })
  await api.signIn()
})

after(async () => {
  await api.close()
})

test('an engine round-trips through create, patch and delete', async () => {
  const { engine } = await api.post<{ engine: EngineRow }>('/api/admin/engines', {
    name: 'DuckDuckGo',
    urlTemplate: 'https://duckduckgo.com/?q={query}',
  })

  assert.equal(engine.name, 'DuckDuckGo')

  const patched = await api
    .request(`/api/admin/engines/${engine.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'DDG' }),
    })
    .then((r) => r.json() as Promise<{ engine: EngineRow }>)
  assert.equal(patched.engine.name, 'DDG')
  assert.equal(patched.engine.urlTemplate, engine.urlTemplate)

  assert.equal(
    (await api.request(`/api/admin/engines/${engine.id}`, { method: 'DELETE' })).status,
    200,
  )
  assert.equal(
    (await api.request(`/api/admin/engines/${engine.id}`, { method: 'DELETE' })).status,
    404,
  )
})

// The first entry is the default the bar starts on, so ordering engines is also how the
// default is chosen.
test('reordering engines decides which one is the default', async () => {
  const create = async (name: string): Promise<EngineRow> =>
    (
      await api.post<{ engine: EngineRow }>('/api/admin/engines', {
        name,
        urlTemplate: `https://${name}.test/?q={query}`,
      })
    ).engine

  const first = await create('alpha')
  const second = await create('beta')

  await api.request('/api/admin/engines/order', {
    method: 'PUT',
    body: JSON.stringify({ ids: [second.id, first.id] }),
  })

  const { engines } = await api.get<{ engines: EngineRow[] }>('/api/config')
  assert.equal(engines[0]?.name, 'beta')
})

test('an engine template is held to the same rule as a command template', async () => {
  for (const urlTemplate of ['https://example.test/search', 'javascript:x({query})']) {
    const response = await api.request('/api/admin/engines', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bad', urlTemplate }),
    })

    assert.equal(response.status, 400, urlTemplate)
  }
})

test('a local port defaults to https and coerces a numeric string', async () => {
  const { port } = await api.post<{ port: PortRow }>('/api/admin/localhost', {
    port: '5173',
    keywords: ['vue'],
  })

  assert.equal(port.scheme, 'https')
  assert.equal(port.port, 5173)
  assert.deepEqual(port.keywords, ['vue'])
})

test('a port outside the range is refused', async () => {
  for (const value of [0, 65536, -1, 'not-a-port']) {
    const response = await api.request('/api/admin/localhost', {
      method: 'POST',
      body: JSON.stringify({ port: value }),
    })

    assert.equal(response.status, 400, String(value))
  }
})

// Off by default, because probing every port costs a request per port on every load.
test('local ports stay out of the portal until the feature is switched on', async () => {
  await api.post('/api/admin/localhost', { port: 3000, scheme: 'http' })

  const before = await api.get<{ localhost: PortRow[] }>('/api/config')
  assert.deepEqual(before.localhost, [])

  await api.request('/api/admin/features/localhost/enabled', {
    method: 'PUT',
    body: JSON.stringify({ enabled: true }),
  })

  const after = await api.get<{ localhost: PortRow[] }>('/api/config')
  assert.ok(after.localhost.length > 0)
})

test('a port round-trips through patch and delete', async () => {
  const { port } = await api.post<{ port: PortRow }>('/api/admin/localhost', { port: 8080 })

  const patched = await api
    .request(`/api/admin/localhost/${port.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ scheme: 'http' }),
    })
    .then((r) => r.json() as Promise<{ port: PortRow }>)
  assert.equal(patched.port.scheme, 'http')
  assert.equal(patched.port.port, 8080)

  assert.equal(
    (await api.request(`/api/admin/localhost/${port.id}`, { method: 'DELETE' })).status,
    200,
  )
  assert.equal(
    (await api.request(`/api/admin/localhost/${port.id}`, { method: 'DELETE' })).status,
    404,
  )
})

const SAFE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>'

test('an uploaded icon is stored, listed and removable', async () => {
  const { icon } = await api.post<{ icon: ApiIcon }>('/api/admin/icons', {
    name: 'square',
    svg: SAFE_ICON,
  })

  assert.equal(icon.name, 'square')
  assert.match(icon.svg, /<path/)

  const { icons } = await api.get<{ icons: ApiIcon[] }>('/api/admin/icons')
  assert.ok(icons.some((entry) => entry.id === icon.id))

  assert.equal((await api.request(`/api/admin/icons/${icon.id}`, { method: 'DELETE' })).status, 200)
  assert.equal((await api.request(`/api/admin/icons/${icon.id}`, { method: 'DELETE' })).status, 404)
})

// Sanitised on the way in, so the database only ever holds markup that is safe to inline and a
// later reader cannot forget to clean it.
test('markup that would run is stripped before it is ever stored', async () => {
  const hostile = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">',
    '<script>alert(1)</script>',
    '<path d="M0 0h24v24H0z" onload="alert(2)"/>',
    '<foreignObject><circle r="3"/></foreignObject>',
    '<a href="javascript:alert(3)"><circle r="1"/></a>',
    '<![CDATA[</style><img src="x" onerror="alert(4)"/>]]>',
    '</svg>',
  ].join('')

  const { icon } = await api.post<{ icon: ApiIcon }>('/api/admin/icons', {
    name: 'hostile',
    svg: hostile,
  })

  for (const fragment of [
    'script',
    'onload',
    'onerror',
    'foreignObject',
    'javascript:',
    'CDATA',
    'alert',
  ]) {
    assert.equal(icon.svg.includes(fragment), false, `${fragment} survived sanitising`)
  }

  assert.match(icon.svg, /<path/)
})

test('an svg the sanitiser refuses outright answers 400 rather than storing nothing', async () => {
  for (const svg of ['<div>not an svg</div>', '<svg xmlns="http://www.w3.org/2000/svg"></svg>']) {
    const response = await api.request('/api/admin/icons', {
      method: 'POST',
      body: JSON.stringify({ name: 'refused', svg }),
    })

    assert.equal(response.status, 400, svg)
  }
})

// The mirror of the links one: a default surviving `.partial()` arrived as a value the parse
// filled in, so an empty body used to reset the scheme to https and wipe the keywords on the way
// through. Both schemas carry the same fix, so both need the same guard.
test('an empty patch of a port is refused rather than quietly resetting it', async () => {
  const { port } = await api.post<{ port: PortRow }>('/api/admin/localhost', {
    port: 9090,
    scheme: 'http',
    keywords: ['api'],
  })

  const response = await api.request(`/api/admin/localhost/${port.id}`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  })
  assert.equal(response.status, 400)

  const { rows } = await api.get<{ rows: PortRow[] }>('/api/admin/localhost')
  const after = rows.find((row) => row.id === port.id)
  assert.equal(after?.scheme, 'http')
  assert.deepEqual(after?.keywords, ['api'])
})

test('patching one field of a port leaves the ones it never named alone', async () => {
  const { port } = await api.post<{ port: PortRow }>('/api/admin/localhost', {
    port: 9091,
    scheme: 'http',
    keywords: ['keep', 'these'],
  })

  await api.request(`/api/admin/localhost/${port.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ port: 9092 }),
  })

  const { rows } = await api.get<{ rows: PortRow[] }>('/api/admin/localhost')
  const after = rows.find((row) => row.id === port.id)
  assert.equal(after?.port, 9092)
  assert.equal(after?.scheme, 'http')
  assert.deepEqual(after?.keywords, ['keep', 'these'])
})
