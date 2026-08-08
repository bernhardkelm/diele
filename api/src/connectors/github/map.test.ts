import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapOwner, mapRepo, mergeRepos } from './map.js'

const REPO = {
  id: 4102,
  name: 'example-app',
  full_name: 'example-org/example-app',
  html_url: 'https://github.com/example-org/example-app',
  pushed_at: '2026-08-01T10:00:00.000Z',
  archived: false,
  owner: { login: 'example-org' },
}

test('a repo maps onto a row with its quick jumps expanded', () => {
  const entry = mapRepo(REPO)

  assert.equal(entry?.localRef, 'repo:4102')
  assert.equal(entry?.kind, 'row')
  assert.equal(entry?.label, 'example-app')
  assert.equal(entry?.detail, 'example-org')
  assert.equal(entry?.timestamp, '2026-08-01T10:00:00.000Z')
  assert.deepEqual(entry?.actions, [
    {
      label: '',
      title: 'example-org/example-app',
      href: 'https://github.com/example-org/example-app',
    },
    {
      label: 'ci',
      title: 'Actions',
      href: 'https://github.com/example-org/example-app/actions',
    },
    {
      label: 'pr',
      title: 'Pull requests',
      href: 'https://github.com/example-org/example-app/pulls',
    },
    {
      label: 'releases',
      title: 'Releases',
      href: 'https://github.com/example-org/example-app/releases',
    },
  ])
})

// The ref is the numeric id rather than the name, so a renamed repo keeps its launch history.
test('a renamed repo keeps its ref', () => {
  const before = mapRepo(REPO)
  const after = mapRepo({
    ...REPO,
    name: 'example-web',
    full_name: 'example-org/example-web',
    html_url: 'https://github.com/example-org/example-web',
  })

  assert.equal(before?.localRef, after?.localRef)
  assert.notEqual(before?.url, after?.url)
})

test('an entry missing an id, a full name or a url is dropped rather than thrown on', () => {
  assert.equal(mapRepo(null), undefined)
  assert.equal(mapRepo('nonsense'), undefined)
  assert.equal(mapRepo({ ...REPO, id: undefined }), undefined)
  assert.equal(mapRepo({ ...REPO, html_url: undefined }), undefined)
  assert.equal(mapRepo({ ...REPO, full_name: undefined }), undefined)
})

// GitHub's listing endpoints take no archived filter, so the mapper is where they are left out.
test('an archived repo is dropped', () => {
  assert.equal(mapRepo({ ...REPO, archived: true }), undefined)
})

test('the owner falls back to the full name when GitHub reports none', () => {
  assert.equal(mapRepo({ ...REPO, owner: undefined })?.detail, 'example-org')
})

test('a repo arriving through two owners arrives once', () => {
  const merged = mergeRepos([[REPO], [REPO, { ...REPO, id: 7, name: 'other' }]])

  assert.deepEqual(
    merged.map((entry) => entry.localRef),
    ['repo:4102', 'repo:7'],
  )
})

test('an owner row is search only and sorts ahead of every repo', () => {
  const owner = mapOwner('https://github.com', 'example-org')
  const repo = mapRepo(REPO)

  assert.equal(owner.searchOnly, true)
  assert.equal(owner.url, 'https://github.com/example-org')
  assert.deepEqual(owner.actions, undefined)
  assert.ok(owner.sortKey! < repo!.sortKey!)
})

// Owner names are case-insensitive on GitHub, so a differently cased config entry must still
// parent the repos GitHub reports under the canonical casing.
test('a mixed-case owner name still joins parent to child', () => {
  const owner = mapOwner('https://github.com', 'Example-Org')
  const repo = mapRepo(REPO)

  assert.equal(owner.localRef, repo?.parentLocalRef)
  assert.equal(owner.label, 'Example-Org')
})
