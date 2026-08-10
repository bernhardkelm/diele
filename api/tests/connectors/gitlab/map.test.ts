import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapGroup, mapProject, mergeProjects } from '#connectors/gitlab/map.js'

const PROJECT = {
  id: 1449,
  name: 'example-app',
  path_with_namespace: 'example-group/example-app',
  web_url: 'https://gitlab.com/example-group/example-app',
  last_activity_at: '2026-08-01T10:00:00.000Z',
  namespace: { full_path: 'example-group' },
}

test('a project maps onto a row with its quick jumps expanded', () => {
  const entry = mapProject(PROJECT)

  assert.equal(entry?.localRef, 'repo:1449')
  assert.equal(entry?.kind, 'row')
  assert.equal(entry?.label, 'example-app')
  assert.equal(entry?.detail, 'example-group')
  assert.equal(entry?.timestamp, '2026-08-01T10:00:00.000Z')
  assert.deepEqual(entry?.actions, [
    {
      label: '',
      title: 'example-group/example-app',
      href: 'https://gitlab.com/example-group/example-app',
    },
    {
      label: 'ci',
      title: 'Pipelines',
      href: 'https://gitlab.com/example-group/example-app/-/pipelines',
    },
    {
      label: 'mr',
      title: 'Merge requests',
      href: 'https://gitlab.com/example-group/example-app/-/merge_requests',
    },
    {
      label: 'releases',
      title: 'Releases',
      href: 'https://gitlab.com/example-group/example-app/-/releases',
    },
  ])
})

// The ref is the numeric id rather than the path, so a renamed repo keeps its launch history.
test('a renamed repo keeps its ref', () => {
  const before = mapProject(PROJECT)
  const after = mapProject({
    ...PROJECT,
    name: 'example-web',
    path_with_namespace: 'example-group/example-web',
    web_url: 'https://gitlab.com/example-group/example-web',
  })

  assert.equal(before?.localRef, after?.localRef)
  assert.notEqual(before?.url, after?.url)
})

test('an entry missing an id, a path or a url is dropped rather than thrown on', () => {
  assert.equal(mapProject(null), undefined)
  assert.equal(mapProject('nonsense'), undefined)
  assert.equal(mapProject({ ...PROJECT, id: undefined }), undefined)
  assert.equal(mapProject({ ...PROJECT, web_url: undefined }), undefined)
  assert.equal(mapProject({ ...PROJECT, path_with_namespace: undefined }), undefined)
})

test('the namespace falls back to the path when GitLab reports none', () => {
  assert.equal(mapProject({ ...PROJECT, namespace: undefined })?.detail, 'example-group')
})

test('a repo shared into two groups arrives once', () => {
  const merged = mergeProjects([[PROJECT], [PROJECT, { ...PROJECT, id: 2, name: 'other' }]])

  assert.deepEqual(
    merged.map((entry) => entry.localRef),
    ['repo:1449', 'repo:2'],
  )
})

test('a group row is search only and sorts ahead of every repo', () => {
  const group = mapGroup('https://gitlab.com', 'example-group')
  const repo = mapProject(PROJECT)

  assert.equal(group.searchOnly, true)
  assert.equal(group.url, 'https://gitlab.com/example-group')
  assert.deepEqual(group.actions, undefined)
  assert.ok(group.sortKey! < repo!.sortKey!)
})
