import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listEntries, replaceEntries } from '#connectors/entries.js'
import { createConnector } from '#connectors/repository.js'
import type { ProducedEntry } from '#connectors/types.js'
import { getDb } from '#db/index.js'

/**
 * Builds one produced entry, so a test names only what it is about.
 * @param {string} localRef - Identity within the connector
 * @returns {ProducedEntry} - Entry to write
 */
function entry(localRef: string): ProducedEntry {
  return {
    localRef,
    kind: 'row',
    label: localRef,
    url: `https://gitlab.com/${localRef}`,
  }
}

/**
 * Creates a connector to write entries against.
 * @param {string} label - Name to tell it apart by
 * @returns {number} - Its id
 */
function connector(label: string): number {
  return createConnector({
    type: 'gitlab',
    label,
    config: { baseUrl: 'https://gitlab.com', groups: ['g'], includeSubgroups: true },
    syncIntervalSeconds: 900,
  }).id
}

/**
 * Reads back the refs one connector currently holds.
 * @param {number} id - Connector to read
 * @returns {string[]} - Its entry refs, sorted
 */
function refsOf(id: number): string[] {
  return listEntries()
    .filter((row) => row.connectorId === id)
    .map((row) => row.ref)
    .sort()
}

test('a complete run sweeps what it no longer produces', () => {
  const id = connector('complete')

  replaceEntries(id, 'gitlab', [entry('repo:1'), entry('repo:2')])
  assert.deepEqual(refsOf(id), [`gitlab:${id}:repo:1`, `gitlab:${id}:repo:2`])

  replaceEntries(id, 'gitlab', [entry('repo:1')])
  assert.deepEqual(refsOf(id), [`gitlab:${id}:repo:1`])
})

// The one that is data loss if it regresses: a run that reached only some of its groups must
// not take the entries of the groups it never asked about with it.
test('a partial run leaves the rows it did not touch standing', () => {
  const id = connector('partial')

  replaceEntries(id, 'gitlab', [entry('repo:1'), entry('repo:2')])
  replaceEntries(id, 'gitlab', [entry('repo:1')], { partial: true })

  assert.deepEqual(refsOf(id), [`gitlab:${id}:repo:1`, `gitlab:${id}:repo:2`])
})

test('one connector sweeping does not touch another', () => {
  const first = connector('first')
  const second = connector('second')

  replaceEntries(first, 'gitlab', [entry('repo:1')])
  replaceEntries(second, 'gitlab', [entry('repo:9')])
  replaceEntries(first, 'gitlab', [])

  assert.deepEqual(refsOf(first), [])
  assert.deepEqual(refsOf(second), [`gitlab:${second}:repo:9`])
})

test('refs carry the instance, so two connectors can hold the same repo', () => {
  const first = connector('one')
  const second = connector('two')

  replaceEntries(first, 'gitlab', [entry('repo:1')])
  replaceEntries(second, 'gitlab', [entry('repo:1')])

  assert.deepEqual(refsOf(first), [`gitlab:${first}:repo:1`])
  assert.deepEqual(refsOf(second), [`gitlab:${second}:repo:1`])
})

test('deleting a connector takes its entries with it', () => {
  const id = connector('doomed')
  replaceEntries(id, 'gitlab', [entry('repo:1')])

  getDb().prepare('DELETE FROM connectors WHERE id = ?').run(id)

  assert.deepEqual(refsOf(id), [])
})

// A connector's output is a remote source's word, not an operator's, and every url here is
// rendered as a link on the portal. A compromised or impersonated source must not be able to put
// a script behind a click.
test('an entry whose url is not http(s) is dropped rather than stored', () => {
  const id = connector('hostile-url')

  replaceEntries(id, 'gitlab', [
    { ...entry('good'), url: 'https://gitlab.com/good' },
    { ...entry('script'), url: 'javascript:alert(1)' },
    { ...entry('data'), url: 'data:text/html,<script>alert(1)</script>' },
  ])

  assert.deepEqual(refsOf(id), [`gitlab:${id}:good`])
})

test('an action whose href is not http(s) is dropped, keeping the rest of the entry', () => {
  const id = connector('hostile-action')

  replaceEntries(id, 'gitlab', [
    {
      ...entry('repo'),
      actions: [
        { label: 'ci', title: 'Pipelines', href: 'https://gitlab.com/repo/-/pipelines' },
        { label: 'x', title: 'Hostile', href: 'javascript:alert(1)' },
      ],
    },
  ])

  const stored = listEntries().find((row) => row.connectorId === id)
  assert.deepEqual(
    stored?.actions.map((action) => action.label),
    ['ci'],
  )
})
