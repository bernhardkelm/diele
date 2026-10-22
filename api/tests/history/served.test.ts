import assert from 'node:assert/strict'
import { test } from 'node:test'
import { replaceEntries } from '#connectors/entries.js'
import { createConnector, deleteConnector } from '#connectors/repository.js'
import { knownUrls } from '#history/served.js'
import { createLink, deleteLink } from '#links/repository.js'
import { setEnabled } from '#settings/toggles.js'

// What the portal does not show cannot be repeated by a history line, so it does not shadow one.
test('only what the portal serves under its switches shadows a history entry', () => {
  const card = createLink({
    kind: 'card',
    label: 'Wiki',
    url: 'https://wiki.example/start',
    keywords: [],
  })
  const site = createLink({
    kind: 'site',
    label: 'Chat',
    url: 'https://chat.example',
    keywords: [],
  })
  const connector = createConnector({
    type: 'gitlab',
    label: 'GitLab',
    config: { baseUrl: 'https://gitlab.com', groups: ['g'], includeSubgroups: true },
    syncIntervalSeconds: 900,
  })
  replaceEntries(connector.id, 'gitlab', [
    { localRef: 'repo:1', kind: 'row', label: 'Repo', url: 'https://gitlab.com/g/repo' },
  ])

  const mine = ['https://chat.example/', 'https://gitlab.com/g/repo', 'https://wiki.example/start']
  const known = knownUrls()
  assert.ok(
    mine.every((url) => known.has(url)),
    [...known].join(' '),
  )

  setEnabled('cards', false)
  setEnabled('sites', false)
  setEnabled('gitlab', false)
  assert.deepEqual([...knownUrls()], [])

  setEnabled('cards', true)
  setEnabled('sites', true)
  setEnabled('gitlab', true)
  deleteLink(card.id)
  deleteLink(site.id)
  deleteConnector(connector.id)
})
