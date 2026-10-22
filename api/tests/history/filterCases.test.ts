import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { acceptVisit, type VisitFilter } from '#history/filters.js'
import { titleToStore } from '#history/titles.js'

interface FilterCase {
  readonly url: string
  readonly title?: string
  readonly expect: { readonly stored: string | null; readonly title: string | null }
}

interface FilterCases {
  readonly context: VisitFilter
  readonly cases: ReadonlyArray<FilterCase>
}

// Shared with the extension's port of these filters, which reads the same file by path.
const fixture = JSON.parse(
  readFileSync(new URL('fixtures/filterCases.json', import.meta.url), 'utf8'),
) as FilterCases

test('every shared filter case is stored and titled as the fixture says, without DNS', () => {
  for (const entry of fixture.cases) {
    const stored = acceptVisit(entry.url, fixture.context) ?? null
    const title = stored === null ? null : (titleToStore(entry.title, entry.url) ?? null)

    assert.deepEqual({ stored, title }, entry.expect, entry.url)
  }
})
