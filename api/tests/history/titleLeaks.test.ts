import assert from 'node:assert/strict'
import { test } from 'node:test'
import { titleLeaksUrl } from '#history/titleLeaks.js'

/**
 * Asks whether a title leaks its url.
 * @param {string} title - Title, already cleaned
 * @param {string} raw - Url as reported
 * @returns {boolean} - What the check answered
 */
function leaks(title: string, raw: string): boolean {
  return titleLeaksUrl(title, new URL(raw))
}

// A site search titles its results page with the term that stripping the query was meant to drop.
test('a title holding a query value or a fragment piece leaks it', () => {
  assert.equal(
    leaks('Embarrassing Thing - Search', 'https://shop.example/find?q=embarrassing+thing'),
    true,
  )
  assert.equal(
    leaks('embarrassing thing', 'https://shop.example/find?q=embarrassing%20thing'),
    true,
  )
  assert.equal(leaks('abcdefgh12345', 'https://app.example/callback#token=abcdefgh12345'), true)
  assert.equal(leaks('Results for Payroll', 'https://intranet.example/#/search?term=PAYROLL'), true)
})

test('a title sharing nothing with the query or fragment is kept', () => {
  assert.equal(
    leaks('Kubernetes overview', 'https://grafana.example/d/abc/overview?orgId=1&from=now-6h'),
    false,
  )
  assert.equal(leaks('Installation guide', 'https://docs.example/guide?lang=en#setup'), false)
  assert.equal(leaks('Inbox', 'https://mail.example/'), false)
})

// Shorter pieces turn up in ordinary titles by chance.
test('pieces shorter than three characters are not compared', () => {
  assert.equal(leaks('Page 1 of the en docs', 'https://docs.example/page?p=1&l=en'), false)
})

// How a browser names a page that has no title of its own.
test('a title that is the address, or repeats the host, is dropped', () => {
  assert.equal(leaks('https://wiki.example.com/start', 'https://wiki.example.com/start'), true)
  assert.equal(leaks('HTTP://wiki.example.com/start', 'http://wiki.example.com/start'), true)
  assert.equal(leaks('wiki.example.com/start', 'https://wiki.example.com/start'), true)
  assert.equal(leaks('example.com', 'https://www.example.com/'), true)
})

test('a single-label host is an ordinary word and does not take the title with it', () => {
  assert.equal(leaks('NAS dashboard', 'http://nas/'), false)
})

// A query value inside a longer word of the title is a coincidence, not the term given away.
test('a piece only counts as whole words of the title', () => {
  assert.equal(leaks('Install', 'https://docs.example/guide?tab=all'), false)
  assert.equal(leaks('Small business guide', 'https://shop.example/?s=all'), false)
  assert.equal(leaks('English docs', 'https://docs.example/?lang=eng'), false)
  assert.equal(leaks('Cafés nearby', 'https://shop.example/find?q=caf%C3%A9'), false)
  assert.equal(leaks('All of it', 'https://docs.example/guide?tab=all'), true)
  assert.equal(leaks('Café Müller', 'https://shop.example/find?q=caf%C3%A9'), true)
  assert.equal(leaks('All-in-one setup', 'https://docs.example/page?q=all-in-one'), true)
  assert.equal(leaks('Search: (thing)', 'https://shop.example/find?q=thing'), true)
})
