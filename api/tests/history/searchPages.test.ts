import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isSearchPage, matchesEngine } from '#history/searchPages.js'

const NONE: ReadonlyArray<string> = []

/**
 * Asks whether a url is a search page against no configured engine.
 * @param {string} raw - Url as reported
 * @returns {boolean} - What the check answered
 */
function builtIn(raw: string): boolean {
  return isSearchPage(new URL(raw), NONE)
}

test('the common search engines are recognised without being configured', () => {
  for (const raw of [
    'https://www.google.com/search?q=diele',
    'https://www.google.de/search?q=diele&hl=de',
    'https://www.bing.com/search?q=diele',
    'https://duckduckgo.com/?q=diele',
    'https://html.duckduckgo.com/html/?q=diele',
    'https://kagi.com/search?q=diele',
    'https://www.ecosia.org/search?method=index&q=diele',
    'https://www.startpage.com/sp/search?query=diele',
    'https://www.youtube.com/results?search_query=diele',
    'https://github.com/search?q=diele&type=repositories',
    'https://github.example.com/search?q=diele',
    'https://gitlab.com/search?search=diele',
    'https://gitlab.example.com/search?search=diele&group_id=4',
    'https://www.google.com/maps/search/pharmacy+near+me',
    'https://www.google.de/maps/place/Somewhere/@48.1,11.5,15z',
    'https://maps.google.com/maps?q=clinic',
  ]) {
    assert.equal(builtIn(raw), true, raw)
  }
})

// Only the results page: the same hosts serve plenty of pages worth keeping.
test('pages on those hosts that are not results are kept', () => {
  for (const raw of [
    'https://www.google.com/maps',
    'https://duckduckgo.com/about',
    'https://www.youtube.com/watch?v=abc',
    'https://www.youtube.com/results',
    'https://github.com/bernhardkelm/diele/pull/27',
    'https://gitlab.example.com/group/project/-/merge_requests/3',
    'https://example.com/search',
    'https://example.com/research?q=1',
  ]) {
    assert.equal(builtIn(raw), false, raw)
  }
})

test('a configured engine with the term in a parameter matches its own results page', () => {
  const template = 'https://search.example.com/find?term={query}&lang=en'

  assert.equal(matchesEngine(new URL('https://search.example.com/find?term=x'), template), true)
  assert.equal(matchesEngine(new URL('https://search.example.com/find?lang=en'), template), false)
  assert.equal(matchesEngine(new URL('https://search.example.com/other?term=x'), template), false)
  assert.equal(matchesEngine(new URL('https://elsewhere.example.com/find?term=x'), template), false)
})

test('a configured engine with the term in its path matches anything below the prefix', () => {
  const template = 'https://wiki.example.com/w/search/{query}'

  assert.equal(
    matchesEngine(new URL('https://wiki.example.com/w/search/kubernetes'), template),
    true,
  )
  assert.equal(matchesEngine(new URL('https://wiki.example.com/w/search/'), template), false)
  assert.equal(matchesEngine(new URL('https://wiki.example.com/w/page'), template), false)
})

// The stock `/maps` command writes its term into the path, so the whole prefix is a search.
test('a slash command template with the term in its path matches under its prefix', () => {
  const template = 'https://www.google.com/maps/search/{query}'

  assert.equal(matchesEngine(new URL('https://www.google.com/maps/search/clinic'), template), true)
  assert.equal(matchesEngine(new URL('https://www.google.com/maps'), template), false)
})

// The template names one spelling of the site; the same results live under the others.
test('a template matches its host with or without www, and below it', () => {
  const template = 'https://www.reddit.com/r/{query}'

  for (const raw of [
    'https://www.reddit.com/r/homelab',
    'https://reddit.com/r/homelab',
    'https://old.reddit.com/r/homelab',
    'http://reddit.com/r/homelab',
  ]) {
    assert.equal(matchesEngine(new URL(raw), template), true, raw)
  }

  for (const raw of [
    'https://notreddit.com/r/homelab',
    'https://reddit.com.evil.test/r/homelab',
    'https://reddit.com:8443/r/homelab',
    'https://reddit.com/user/x',
  ]) {
    assert.equal(matchesEngine(new URL(raw), template), false, raw)
  }
})

test('a template that cannot be parsed matches nothing rather than throwing', () => {
  assert.equal(matchesEngine(new URL('https://example.com/'), 'not a template {query}'), false)
})

test('the configured engines are consulted alongside the built-in list', () => {
  const url = new URL('https://search.example.com/find?term=x')

  assert.equal(isSearchPage(url, NONE), false)
  assert.equal(isSearchPage(url, ['https://search.example.com/find?term={query}']), true)
})
