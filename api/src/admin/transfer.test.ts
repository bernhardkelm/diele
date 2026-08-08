import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { ApiConfig, ApiIcon } from '@diele/common'
import type { ExportPayload } from '#admin/exportConfig.js'
import { VERSION } from '#admin/transferVersion.js'
import { startApi, type TestApi } from '#testing/harness.js'

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h8v8H0z"/></svg>'

let api: TestApi

/**
 * Fills a portal with one row of each kind, so an export has something to carry.
 * @returns {Promise<number>} - Id of the uploaded icon, which the card points at
 */
async function seed(): Promise<number> {
  const { icon } = await api.post<{ icon: ApiIcon }>('/api/admin/icons', {
    name: 'square',
    svg: ICON,
  })

  await api.post('/api/admin/links/card', {
    label: 'Grafana',
    url: 'https://grafana.test',
    keywords: ['metrics'],
    iconId: icon.id,
    color: '#1E88E5',
  })
  await api.post('/api/admin/links/site', { label: 'Docs', url: 'https://docs.test' })
  await api.post('/api/admin/engines', {
    name: 'DuckDuckGo',
    urlTemplate: 'https://duckduckgo.com/?q={query}',
  })
  await api.post('/api/admin/localhost', { port: 5173, keywords: ['vue'] })
  await api.post('/api/admin/commands', {
    keyword: 'yt',
    urlTemplate: 'https://youtube.test/?q={query}',
  })
  await api.request('/api/admin/features/reddit/enabled', {
    method: 'PUT',
    body: JSON.stringify({ enabled: false }),
  })

  return icon.id
}

before(async () => {
  api = await startApi({ AUTH_MODE: 'dev' })
  await api.signIn()
})

after(async () => {
  await api.close()
})

test('an export carries every section and stamps its version', async () => {
  await seed()
  const payload = await api.get<ExportPayload>('/api/admin/export')

  assert.equal(payload.version, VERSION)
  assert.ok(Date.parse(payload.exportedAt) > 0)
  assert.equal(payload.icons.length, 1)
  assert.equal(payload.cards.length, 1)
  assert.equal(payload.sites.length, 1)
  assert.equal(payload.engines.length, 1)
  assert.equal(payload.localhost.length, 1)
  assert.equal(payload.commands.length, 1)
  assert.deepEqual(payload.cards[0]?.keywords, ['metrics'])
  assert.equal(payload.settings['reddit.enabled'], false)
})

// An export is a file that gets mailed around and committed, which is the last place a token
// belongs. This is the assertion that has to keep holding as sections are added.
test('an export carries no credentials, whatever it does carry', async () => {
  const payload = await api.get<ExportPayload>('/api/admin/export')
  const serialised = JSON.stringify(payload)

  for (const forbidden of ['secret', 'token', 'password', 'credential', 'ciphertext']) {
    assert.equal(serialised.toLowerCase().includes(forbidden), false, forbidden)
  }
})

test('an import replaces the configuration and reports what it wrote', async () => {
  const exported = await api.get<ExportPayload>('/api/admin/export')

  const replacement = {
    ...exported,
    cards: [
      {
        label: 'Replaced',
        url: 'https://replaced.test',
        keywords: ['new'],
        iconId: null,
        color: null,
        display: null,
        position: 1000,
        enabled: true,
      },
    ],
    sites: [],
  }

  const result = await api.post<{ ok: boolean; written: Record<string, number> }>(
    '/api/admin/import',
    replacement,
  )

  assert.equal(result.ok, true)
  assert.equal(result.written.cards, 1)
  assert.equal(result.written.sites, 0)

  const config = await api.get<ApiConfig>('/api/config')
  assert.equal(config.cards.length, 1)
  assert.equal(config.cards[0]?.label, 'Replaced')
  assert.deepEqual(config.sites, [])
})

test('an export taken after an import reproduces it', async () => {
  const first = await api.get<ExportPayload>('/api/admin/export')

  await api.post('/api/admin/import', first)

  const second = await api.get<ExportPayload>('/api/admin/export')

  // Everything but the timestamp, which is when the file was written rather than what is in it.
  assert.deepEqual({ ...second, exportedAt: '' }, { ...first, exportedAt: '' })
})

// The file may have been edited or come from somewhere else entirely, and it is about to be
// inlined into the portal's own page.
test('an imported icon is sanitised again rather than trusted', async () => {
  const exported = await api.get<ExportPayload>('/api/admin/export')

  await api.post('/api/admin/import', {
    ...exported,
    icons: [
      {
        id: 1,
        name: 'tampered',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>alert(1)</script><path d="M0 0h8v8H0z" onclick="alert(2)"/></svg>',
      },
    ],
    cards: [],
  })

  const { icons } = await api.get<{ icons: ApiIcon[] }>('/api/admin/icons')
  const stored = icons.find((icon) => icon.name === 'tampered')

  assert.ok(stored)
  assert.equal(stored.svg.includes('script'), false)
  assert.equal(stored.svg.includes('onclick'), false)
  assert.match(stored.svg, /<path/)
})

// Losing a logo is better than losing the import, so a dangling reference is dropped rather
// than violating the foreign key.
test('a card pointing at an icon the file did not carry keeps its row and loses its logo', async () => {
  const exported = await api.get<ExportPayload>('/api/admin/export')

  await api.post('/api/admin/import', {
    ...exported,
    icons: [],
    cards: [
      {
        label: 'Orphaned',
        url: 'https://orphan.test',
        keywords: [],
        iconId: 4242,
        color: null,
        display: null,
        position: 1000,
        enabled: true,
      },
    ],
  })

  const config = await api.get<ApiConfig>('/api/config')
  assert.equal(config.cards[0]?.label, 'Orphaned')
  assert.equal(config.cards[0]?.iconId, null)
})

// Version 1 files predate connectors and simply carry none.
test('a version 1 file still applies', async () => {
  const response = await api.post<{ ok: boolean }>('/api/admin/import', {
    version: 1,
    cards: [],
    sites: [],
    engines: [],
    localhost: [],
    commands: [],
    settings: {},
  })

  assert.equal(response.ok, true)
})

test('a file from a version this build does not know is refused rather than half applied', async () => {
  for (const version of [0, 3, 99, 'two']) {
    const response = await api.request('/api/admin/import', {
      method: 'POST',
      body: JSON.stringify({ version, cards: [] }),
    })

    assert.equal(response.status, 400, String(version))
  }
})

// One transaction, so a rejected row cannot leave half a portal behind.
test('a rejected import leaves the previous configuration standing', async () => {
  await api.post('/api/admin/import', {
    version: VERSION,
    cards: [
      {
        label: 'Survivor',
        url: 'https://survivor.test',
        keywords: [],
        position: 1,
        enabled: true,
      },
    ],
    sites: [],
    engines: [],
    localhost: [],
    commands: [],
    settings: {},
  })

  const refused = await api.request('/api/admin/import', {
    method: 'POST',
    body: JSON.stringify({
      version: VERSION,
      cards: [{ label: '', url: '', position: 'not a number', enabled: true }],
    }),
  })
  assert.equal(refused.status, 400)

  const config = await api.get<ApiConfig>('/api/config')
  assert.equal(config.cards[0]?.label, 'Survivor')
})

// An imported file may have been edited by hand or come from somewhere else entirely, so it is
// held to the same rules a typed row is. These values end up in an href, and `javascript:` there
// is a script behind a click, served to everyone signed in rather than only the admin who
// imported it.
test('an import refuses a url that is not http(s)', async () => {
  const exported = await api.get<ExportPayload>('/api/admin/export')

  for (const url of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '/relative']) {
    const response = await api.request('/api/admin/import', {
      method: 'POST',
      body: JSON.stringify({
        ...exported,
        cards: [{ label: 'Hostile', url, keywords: [], position: 1000, enabled: true }],
      }),
    })

    assert.equal(response.status, 400, url)
  }
})

test('an import refuses a search engine or command template that is not http(s)', async () => {
  const exported = await api.get<ExportPayload>('/api/admin/export')

  const engine = await api.request('/api/admin/import', {
    method: 'POST',
    body: JSON.stringify({
      ...exported,
      engines: [
        { name: 'Hostile', urlTemplate: 'javascript:alert({query})', position: 1000, enabled: true },
      ],
    }),
  })
  assert.equal(engine.status, 400)

  const command = await api.request('/api/admin/import', {
    method: 'POST',
    body: JSON.stringify({
      ...exported,
      commands: [
        { keyword: 'x', urlTemplate: 'javascript:alert({query})', position: 1000, enabled: true },
      ],
    }),
  })
  assert.equal(command.status, 400)
})

test('an import refuses a colour that is not a plain hex', async () => {
  const exported = await api.get<ExportPayload>('/api/admin/export')

  const response = await api.request('/api/admin/import', {
    method: 'POST',
    body: JSON.stringify({
      ...exported,
      cards: [
        {
          label: 'Hostile',
          url: 'https://ok.test',
          color: 'red; background: url(https://evil.test)',
          keywords: [],
          position: 1000,
          enabled: true,
        },
      ],
    }),
  })

  assert.equal(response.status, 400)
})

// The portal answers these itself and wins over a stored command either way, so one imported
// under a built-in name would be a row the operator can see but never reach.
test('an import refuses a command that redefines a built-in keyword', async () => {
  const exported = await api.get<ExportPayload>('/api/admin/export')

  const response = await api.request('/api/admin/import', {
    method: 'POST',
    body: JSON.stringify({
      ...exported,
      commands: [
        {
          keyword: 'settings',
          urlTemplate: 'https://evil.test/?q={query}',
          position: 1000,
          enabled: true,
        },
      ],
    }),
  })

  assert.equal(response.status, 400)
})

// The whole point of an export is being able to read it back.
test('an export of the seeded portal imports cleanly', async () => {
  const exported = await api.get<ExportPayload>('/api/admin/export')
  const response = await api.request('/api/admin/import', {
    method: 'POST',
    body: JSON.stringify(exported),
  })

  assert.equal(response.status, 200)
})

// Every icon is capped at 64KB on its own, so a portal with a few dozen of them exports a
// document larger than an ordinary request limit. An export that cannot be read back is not a
// backup.
test('an export far larger than an ordinary request body still imports', async () => {
  const exported = await api.get<ExportPayload>('/api/admin/export')
  const filler = 'M0 0h8v8H0z'.repeat(5000)
  const icons = Array.from({ length: 24 }, (_unused, index) => ({
    id: index + 100,
    name: `bulky-${index}`,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${filler}"/></svg>`,
  }))

  const body = JSON.stringify({ ...exported, icons, cards: [], sites: [] })
  assert.ok(body.length > 1024 * 1024, 'fixture is not larger than the ordinary 1mb limit')

  const response = await api.request('/api/admin/import', { method: 'POST', body })

  assert.equal(response.status, 200)
})

// A body past even the import's own limit is something the caller can act on, so it says so
// rather than reporting the instance as broken.
test('a body past the import limit answers 413 rather than 500', async () => {
  const response = await api.request('/api/admin/import', {
    method: 'POST',
    body: JSON.stringify({ version: VERSION, filler: 'x'.repeat(33 * 1024 * 1024) }),
  })

  assert.equal(response.status, 413)
})
