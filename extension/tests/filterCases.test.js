import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { FILTER_FILES, loadScripts } from './load.js'

// The server's own cases, read where its tests keep them, so the two filters cannot drift apart
// without one of the suites saying so
const FIXTURE = new URL('../../api/tests/history/fixtures/filterCases.json', import.meta.url)

const { context, cases } = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const scripts = loadScripts(FILTER_FILES)

const FILTER = {
  instanceOrigins: [context.ownOrigin],
  searchPatterns: context.engineTemplates
    .map((template) => scripts.compileSearchTemplate(template))
    .filter((pattern) => pattern !== undefined),
  excludedDomains: context.excludedDomains,
}

/**
 * Runs one url and title through the extension the way the worker buffers a visit: a title only
 * goes with a url that is kept.
 * @param {string} url - Url as loaded
 * @param {string | undefined} title - Tab title, if the case has one
 * @returns {{stored: string | null, title: string | null}} - What would be buffered
 */
function buffered(url, title) {
  const stored = scripts.acceptHistoryVisit(url, FILTER) ?? null
  const kept = stored === null ? undefined : scripts.cleanHistoryTitle(url, title)

  return { stored, title: kept ?? null }
}

test('the shared fixture holds cases to run', () => {
  assert.ok(cases.length > 0)
})

for (const { url, title, expect } of cases) {
  const titled = title === undefined ? '' : ` titled ${JSON.stringify(title)}`

  test(`as on the server: ${url}${titled}`, () => {
    assert.deepEqual(buffered(url, title), expect)
  })
}
