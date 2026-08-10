import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toApiEntry } from '#connectors/wire.js'
import type { EntryRecord } from '#connectors/entries.js'

const record: EntryRecord = {
  connectorId: 1,
  connectorType: 'gitlab',
  ref: 'gitlab:1:project-2',
  kind: 'row',
  label: 'diele',
  detail: 'example-group',
  url: 'https://gitlab.example/example-group/diele',
  keywords: ['vue', 'api'],
  actions: [],
  timestamp: '2026-01-01T00:00:00.000Z',
  parentRef: 'gitlab:1:group-9',
  searchOnly: false,
  healthRef: 'diele.example',
}

test('a drawable entry is carried onto the wire whole', () => {
  const entry = toApiEntry(record)

  assert.ok(entry)
  assert.equal(entry.ref, record.ref)
  assert.equal(entry.kind, 'row')
  assert.equal(entry.label, 'diele')
  assert.deepEqual(entry.keywords, ['vue', 'api'])
  assert.equal(entry.parentRef, 'gitlab:1:group-9')
})

test('every kind the frontend draws survives', () => {
  for (const kind of ['card', 'row', 'suggestion']) {
    assert.ok(toApiEntry({ ...record, kind }), kind)
  }
})

// A connector cannot make the page render nothing by producing a kind nobody draws.
test('a kind the frontend does not draw is dropped rather than served', () => {
  for (const kind of ['banner', 'ROW', '', 'signal']) {
    assert.equal(toApiEntry({ ...record, kind }), undefined, kind)
  }
})

// The selector is the server's own business: it binds a health check, and the client neither
// reads it nor should be told what a connector suggested.
test('the health selector stays on the server', () => {
  const entry = toApiEntry(record)

  assert.equal('healthRef' in (entry as object), false)
})
