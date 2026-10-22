import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FILTER_FILES, loadScripts } from './load.js'

const scripts = loadScripts([...FILTER_FILES, 'history/buffer.js', 'history/state.js'])

const NOW = Date.parse('2026-10-22T12:00:00Z')
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const BINDING = { instance: 'https://diele.example.com/', account: 'k3Xb9qL2vR8tY1wZ' }

/**
 * Copies a value out of the scripts' realm, so deep comparisons do not trip over its prototypes.
 * @param {unknown} value - Value made inside the context
 * @returns {unknown} - The same data, made here
 */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Builds a visit some time before now.
 * @param {string} url - Stored url
 * @param {number} ago - How long before now, in ms
 * @param {string} [title] - Title, if any
 * @returns {{url: string, at: string, title?: string}} - The visit
 */
function visit(url, ago, title) {
  return { url, at: new Date(NOW - ago).toISOString(), ...(title ? { title } : {}) }
}

/**
 * Adds visits to an empty buffer, in the order given.
 * @param {Array<{url: string, at: string, title?: string}>} visits - Visits to add
 * @returns {object} - The buffer
 */
function bufferOf(visits) {
  let buffer = scripts.emptyHistoryBuffer(BINDING)

  for (const entry of visits) {
    buffer = scripts.addHistoryVisit(buffer, entry, NOW)
  }

  return buffer
}

test('a url loaded twice is one visit, with the later time and title', () => {
  const buffer = bufferOf([
    visit('https://a.example/', 10 * MINUTE, 'Old title'),
    visit('https://a.example/', 2 * MINUTE, 'New title'),
    visit('https://b.example/', 5 * MINUTE),
  ])

  assert.deepEqual(plain(buffer.visits), [
    visit('https://a.example/', 2 * MINUTE, 'New title'),
    visit('https://b.example/', 5 * MINUTE),
  ])
})

test('a later load without a title keeps the title an earlier one reported', () => {
  const buffer = bufferOf([
    visit('https://a.example/', 10 * MINUTE, 'Kept'),
    visit('https://a.example/', 1 * MINUTE),
  ])

  assert.deepEqual(plain(buffer.visits), [visit('https://a.example/', 1 * MINUTE, 'Kept')])
})

test('an older visit arriving late does not wind the time back', () => {
  const buffer = bufferOf([
    visit('https://a.example/', 1 * MINUTE, 'Newer'),
    visit('https://a.example/', 30 * MINUTE, 'Older'),
  ])

  assert.deepEqual(plain(buffer.visits), [visit('https://a.example/', 1 * MINUTE, 'Newer')])
})

test('the buffer keeps the newest 500 and nothing older than a week', () => {
  const visits = Array.from({ length: 520 }, (_, index) =>
    visit(`https://site${index % 30}.example/page-${index}`, index * MINUTE),
  )
  const buffer = bufferOf([...visits, visit('https://stale.example/', 8 * DAY)])

  assert.equal(buffer.visits.length, 500)
  assert.equal(buffer.visits.at(-1).url, 'https://site19.example/page-499')
  assert.equal(
    buffer.visits.some((entry) => entry.url === 'https://stale.example/'),
    false,
  )
})

test('one site holds at most 25 entries, losing its oldest first, and leaves the rest alone', () => {
  const flood = Array.from({ length: 400 }, (_, index) =>
    visit(`https://evil.example/login-${index}`, index * 1000, 'MyBank Online Banking'),
  )
  const buffer = bufferOf([visit('https://real.example/', 30 * MINUTE, 'Real'), ...flood])
  const evil = buffer.visits.filter((entry) => entry.url.startsWith('https://evil.example/'))

  assert.equal(evil.length, 25)
  assert.equal(evil[0].url, 'https://evil.example/login-0')
  assert.equal(evil.at(-1).url, 'https://evil.example/login-24')
  assert.equal(
    buffer.visits.some((entry) => entry.url === 'https://real.example/'),
    true,
  )
})

test('a site shares one cap across its subdomains, under a country suffix too', () => {
  const flood = Array.from({ length: 60 }, (_, index) =>
    visit(`https://a${index}.evil.example/login`, index * 1000),
  )
  const british = Array.from({ length: 30 }, (_, index) =>
    visit(`https://shop${index}.acme.co.uk/`, index * 1000),
  )
  const neighbours = [
    visit('https://other.co.uk/', MINUTE),
    visit('https://real.example/', MINUTE),
    visit('https://notevil.example/', MINUTE),
  ]
  const buffer = bufferOf([...neighbours, ...flood, ...british])
  const urls = buffer.visits.map((entry) => entry.url)

  assert.equal(urls.filter((url) => url.endsWith('.evil.example/login')).length, 25)
  assert.equal(urls.filter((url) => url.endsWith('.acme.co.uk/')).length, 25)
  assert.equal(
    neighbours.every((entry) => urls.includes(entry.url)),
    true,
  )
})

test('a site is the last two labels, three under a common second-level label, an ip itself', () => {
  for (const [hostname, site] of [
    ['example.com', 'example.com'],
    ['a.b.example.com', 'example.com'],
    ['www.bbc.co.uk', 'bbc.co.uk'],
    ['shop.example.com.au', 'example.com.au'],
    ['dept.ox.ac.uk', 'ox.ac.uk'],
    ['co.uk', 'co.uk'],
    ['localhost', 'localhost'],
    ['192.168.1.10', '192.168.1.10'],
    ['10.0.0.1', '10.0.0.1'],
    ['[2001:db8::1]', '[2001:db8::1]'],
  ]) {
    assert.equal(scripts.historySiteOf(hostname), site, hostname)
  }
})

test('a buffer bound to another account or instance is dropped on read', () => {
  const stored = plain(bufferOf([visit('https://a.example/', MINUTE)]))

  assert.equal(scripts.readHistoryBuffer(stored, BINDING, NOW).visits.length, 1)
  assert.equal(
    scripts.readHistoryBuffer(stored, { ...BINDING, account: 'other' }, NOW).visits.length,
    0,
  )
  assert.equal(
    scripts.readHistoryBuffer({ ...stored, account: undefined, userId: 7 }, BINDING, NOW).visits
      .length,
    0,
  )
  assert.equal(
    scripts.readHistoryBuffer(stored, { ...BINDING, instance: 'https://other.example/' }, NOW)
      .visits.length,
    0,
  )
  assert.equal(scripts.readHistoryBuffer('garbage', BINDING, NOW).visits.length, 0)
})

test('a batch goes oldest first, at most 200, and settling keeps what was loaded again since', () => {
  const visits = Array.from({ length: 250 }, (_, index) =>
    visit(`https://site${index % 20}.example/page-${index}`, (index + 1) * MINUTE),
  )
  let buffer = bufferOf(visits)
  const batch = plain(scripts.nextHistoryBatch(buffer))

  assert.equal(batch.length, 200)
  assert.equal(batch[0].url, 'https://site9.example/page-249')

  buffer = scripts.addHistoryVisit(buffer, visit('https://site9.example/page-249', 0), NOW)
  buffer = scripts.settleHistoryVisits(buffer, batch)

  assert.equal(buffer.visits.length, 51)
  assert.equal(
    buffer.visits.some((entry) => entry.url === 'https://site9.example/page-249'),
    true,
  )
})

test('visits on a domain excluded after they were buffered are dropped', () => {
  const buffer = scripts.excludeHistoryDomains(
    bufferOf([visit('https://www.bank.example/x', MINUTE), visit('https://a.example/', MINUTE)]),
    ['bank.example'],
  )

  assert.deepEqual(plain(buffer.visits.map((entry) => entry.url)), ['https://a.example/'])
})

test('only all four switches together record', () => {
  const target = { id: 'one', url: BINDING.instance }
  const report = {
    signedIn: true,
    state: {
      available: true,
      sources: { diele: false, extension: true },
      enabled: true,
      account: BINDING.account,
    },
  }
  const recording = scripts.historyStateFromReport(undefined, report, BINDING.instance, NOW)

  assert.equal(scripts.isHistoryRecording(target, recording), true)
  assert.equal(scripts.isHistoryRecording(undefined, recording), false)
  assert.equal(scripts.historyStatusOf('one', target, recording), 'recording')
  assert.equal(scripts.historyStatusOf('two', target, recording), 'off')

  for (const [state, status] of [
    [{ ...report.state, available: false }, 'refused'],
    [{ ...report.state, sources: { extension: false } }, 'refused'],
    [{ ...report.state, enabled: false }, 'optIn'],
  ]) {
    const cached = scripts.historyStateFromReport(recording, { ...report, state }, target.url, NOW)
    assert.equal(scripts.isHistoryRecording(target, cached), false)
    assert.equal(scripts.historyStatusOf('one', target, cached), status)
  }

  const signedOut = scripts.historyStateFromReport(recording, { signedIn: false }, target.url, NOW)
  assert.equal(scripts.isHistoryRecording(target, signedOut), false)
  assert.equal(signedOut.account, BINDING.account)
  assert.equal(scripts.historyStatusOf('one', target, signedOut), 'signedOut')
  assert.equal(scripts.historyStatusOf('one', target, undefined), 'waiting')
})
