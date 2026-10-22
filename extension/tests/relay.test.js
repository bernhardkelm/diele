import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { ACCOUNT, INSTANCE, ON, RECORDING, TARGET, setup } from './worker.js'

const STATUS = { status: 200, body: { status: 'ok', version: '0.2.2' } }

/**
 * Builds the relay's channel to the worker, as a content script on a page sees it.
 * @param {object} scripts - The loaded scope
 * @param {string} [pageUrl] - Page the relay runs on
 * @returns {(message: object) => Promise<unknown>} - The send function
 */
function channel(scripts, pageUrl = `${INSTANCE}#/`) {
  const sender = { id: 'ext', url: pageUrl, frameId: 0, tab: { id: 3, incognito: false } }

  return (message) =>
    new Promise((resolve) => {
      if (!scripts.onHistoryMessage(structuredClone(message), sender, resolve)) {
        resolve(undefined)
      }
    })
}

/**
 * Builds a fetch that answers each path with a fixed status and body, and records the calls.
 * @param {Record<string, {status: number, body?: unknown, raw?: string} | Array<{status: number}>>} routes -
 *   Answer per path, a JSON body or a raw one; a list answers successive calls in turn
 * @returns {{fetch: Function, calls: Array<{url: string, init: object}>}} - The stub and its calls
 */
function stubFetch(routes) {
  const calls = []

  const fetch = async (url, init) => {
    calls.push({ url, init })
    const path = new URL(url).pathname
    const route = routes[path]
    const answer = Array.isArray(route) ? route.shift() : route

    if (!answer) {
      throw new TypeError('network error')
    }

    return new Response(answer.raw ?? JSON.stringify(answer.body ?? {}), { status: answer.status })
  }

  return { fetch, calls }
}

/**
 * Builds a stored buffer of visits for the account, a minute apart.
 * @param {number} count - How many visits
 * @param {string} [account] - Account the buffer is bound to
 * @returns {object} - The buffer as stored
 */
function storedBuffer(count, account = ACCOUNT) {
  const now = Date.now()
  const visits = Array.from({ length: count }, (_, index) => ({
    url: `https://site${index % 20}.example/page-${index}`,
    title: `Page ${index}`,
    at: new Date(now - (index + 1) * 60_000).toISOString(),
  }))

  return { instance: INSTANCE, account, visits }
}

/**
 * Builds the routes of an instance that is signed in and accepts visits, posting as given.
 * @param {Array<{status: number}>} posts - Answers to successive posts
 * @param {object} [state] - The history state served, naming the account signed in
 * @returns {object} - The routes
 */
function instanceRoutes(posts, state = ON) {
  return {
    '/status': STATUS,
    '/api/history/state': { status: 200, body: { ...state, excludedDomains: [], kept: 0 } },
    '/api/config': { status: 200, body: { engines: [], commands: [] } },
    '/api/history/visits': posts,
  }
}

/**
 * Starts from a browser that recorded for the account and has a buffer waiting.
 * @param {number} count - Visits waiting
 * @param {boolean} [titles] - Whether the titles switch is on
 * @returns {object} - chrome.storage.local's contents
 */
function recordingStorage(count, titles = false) {
  return {
    dieleHistoryTarget: { ...TARGET, titles },
    dieleHistoryState: RECORDING,
    dieleHistoryBuffer: storedBuffer(count),
  }
}

test('a 200 delivers the buffer as the page would send it, and empties it', async () => {
  const { scripts, local } = setup(recordingStorage(3))
  const { fetch, calls } = stubFetch(instanceRoutes([{ status: 200 }]))

  const outcome = await scripts.runHistoryRelay({
    fetch,
    origin: 'https://diele.example.com',
    send: channel(scripts),
  })

  assert.equal(outcome, 'delivered')
  assert.equal(local.dieleHistoryBuffer.visits.length, 0)
  assert.equal(local.dieleHistoryState.refused, false)

  const post = calls.find((call) => call.init.method === 'POST')
  const body = JSON.parse(post.init.body)

  assert.equal(post.url, 'https://diele.example.com/api/history/visits')
  assert.equal(post.init.credentials, 'same-origin')
  assert.equal(body.source, 'extension')
  assert.equal(body.visits.length, 3)
  assert.deepEqual(Object.keys(body.visits[0]).sort(), ['at', 'url'])
})

// A title left in the buffer by a switch flipped mid-run still never leaves with titles off
test('a posted batch carries titles only while the titles switch is on', async () => {
  for (const titles of [false, true]) {
    const { scripts } = setup(recordingStorage(3, titles))
    const { fetch, calls } = stubFetch(instanceRoutes([{ status: 200 }]))

    await scripts.runHistoryRelay({
      fetch,
      origin: 'https://diele.example.com',
      send: channel(scripts),
    })

    const post = calls.find((call) => call.init.method === 'POST')
    assert.equal(/"title"/.test(post.init.body), titles, String(titles))
  }
})

test('a buffer over one batch goes in batches of at most 200', async () => {
  const { scripts, local } = setup(recordingStorage(250))
  const { fetch, calls } = stubFetch(instanceRoutes([{ status: 200 }, { status: 200 }]))

  await scripts.runHistoryRelay({
    fetch,
    origin: 'https://diele.example.com',
    send: channel(scripts),
  })

  const sizes = calls
    .filter((call) => call.init.method === 'POST')
    .map((call) => JSON.parse(call.init.body).visits.length)

  assert.deepEqual(sizes, [200, 50])
  assert.equal(local.dieleHistoryBuffer.visits.length, 0)
})

test('a 403 discards the buffer and remembers the refusal', async () => {
  const { scripts, local } = setup(recordingStorage(3))
  const { fetch } = stubFetch(instanceRoutes([{ status: 403 }]))

  const outcome = await scripts.runHistoryRelay({
    fetch,
    origin: 'https://diele.example.com',
    send: channel(scripts),
  })

  assert.equal(outcome, 'refused')
  assert.equal(local.dieleHistoryBuffer, undefined)
  assert.equal(local.dieleHistoryState.refused, true)
  assert.equal(
    scripts.historyStatusOf('one', local.dieleHistoryTarget, local.dieleHistoryState),
    'refused',
  )
})

test('a 429 or a 401 on the post keeps the buffer for the next load', async () => {
  for (const status of [429, 401, 503]) {
    const { scripts, local } = setup(recordingStorage(3))
    const { fetch } = stubFetch(instanceRoutes([{ status }]))

    const outcome = await scripts.runHistoryRelay({
      fetch,
      origin: 'https://diele.example.com',
      send: channel(scripts),
    })

    assert.equal(outcome, 'kept', String(status))
    assert.equal(local.dieleHistoryBuffer.visits.length, 3, String(status))
    assert.equal(local.dieleHistoryLease, undefined, String(status))
  }
})

// The server will never read a batch it called malformed or too large, and sending it on every
// load would hold back what waits behind it
test('a 400 or a 413 drops that batch and the next one still goes', async () => {
  for (const status of [400, 413]) {
    const { scripts, local } = setup(recordingStorage(250))
    const { fetch, calls } = stubFetch(instanceRoutes([{ status }, { status: 200 }]))

    const outcome = await scripts.runHistoryRelay({
      fetch,
      origin: 'https://diele.example.com',
      send: channel(scripts),
    })

    const sizes = calls
      .filter((call) => call.init.method === 'POST')
      .map((call) => JSON.parse(call.init.body).visits.length)

    assert.equal(outcome, 'delivered', String(status))
    assert.deepEqual(sizes, [200, 50], String(status))
    assert.equal(local.dieleHistoryBuffer.visits.length, 0, String(status))
    assert.equal(local.dieleHistoryLease, undefined, String(status))
  }
})

test('a network failure changes nothing', async () => {
  const { scripts, local } = setup(recordingStorage(3))
  const before = structuredClone(local)
  const { fetch, calls } = stubFetch({})

  const outcome = await scripts.runHistoryRelay({
    fetch,
    origin: 'https://diele.example.com',
    send: channel(scripts),
  })

  assert.equal(outcome, 'offline')
  assert.equal(calls.length, 1)
  assert.deepEqual(local, before)
})

test('signed out, nothing is sent, the buffer waits and recording stops', async () => {
  const { scripts, local } = setup(recordingStorage(3))
  const { fetch, calls } = stubFetch({ '/status': STATUS, '/api/history/state': { status: 401 } })

  const outcome = await scripts.runHistoryRelay({
    fetch,
    origin: 'https://diele.example.com',
    send: channel(scripts),
  })

  assert.equal(outcome, 'idle')
  assert.equal(calls.length, 2)
  assert.equal(local.dieleHistoryBuffer.visits.length, 3)
  assert.equal(scripts.isHistoryRecording(local.dieleHistoryTarget, local.dieleHistoryState), false)
})

test('someone else signed in on the profile never receives the buffer', async () => {
  const { scripts, local } = setup(recordingStorage(3))
  const { fetch, calls } = stubFetch(instanceRoutes([{ status: 200 }], { ...ON, account: 'other' }))

  await scripts.runHistoryRelay({
    fetch,
    origin: 'https://diele.example.com',
    send: channel(scripts),
  })

  assert.equal(calls.filter((call) => call.init.method === 'POST').length, 0)
  assert.equal(local.dieleHistoryBuffer.visits.length, 0)
  assert.equal(local.dieleHistoryBuffer.account, 'other')
})

// A user id can be handed out again after the main database is reset; the account cannot
test('a buffer is bound to the account the state names, never to a user id', async () => {
  const stored = recordingStorage(3)
  stored.dieleHistoryBuffer = { instance: INSTANCE, userId: 7, visits: storedBuffer(3).visits }
  const { scripts, local } = setup(stored)
  const { fetch, calls } = stubFetch(instanceRoutes([{ status: 200 }]))

  await scripts.runHistoryRelay({
    fetch,
    origin: 'https://diele.example.com',
    send: channel(scripts),
  })

  assert.equal(calls.filter((call) => call.init.method === 'POST').length, 0)
  assert.equal(local.dieleHistoryBuffer.account, ACCOUNT)
  assert.equal(local.dieleHistoryBuffer.visits.length, 0)
})

test('a state that names no account records nothing and sends nothing', async () => {
  const { scripts, local } = setup(recordingStorage(3))
  const { account: _unnamed, ...unnamed } = ON
  const { fetch, calls } = stubFetch(instanceRoutes([{ status: 200 }], unnamed))

  await scripts.runHistoryRelay({
    fetch,
    origin: 'https://diele.example.com',
    send: channel(scripts),
  })

  assert.equal(calls.filter((call) => call.init.method === 'POST').length, 0)
  assert.equal(local.dieleHistoryBuffer, undefined)
  assert.equal(scripts.isHistoryRecording(local.dieleHistoryTarget, local.dieleHistoryState), false)
  assert.equal(
    scripts.historyStatusOf('one', local.dieleHistoryTarget, local.dieleHistoryState),
    'optIn',
  )

  await scripts.recordHistoryVisit('https://docs.example.com/guide', 'Guide', Date.now())
  assert.equal(local.dieleHistoryBuffer, undefined)
})

test('a load asks for the state alone, then the templates, then posts', async () => {
  const { scripts } = setup(recordingStorage(3))
  const { fetch, calls } = stubFetch(instanceRoutes([{ status: 200 }]))

  await scripts.runHistoryRelay({
    fetch,
    origin: 'https://diele.example.com',
    send: channel(scripts),
  })

  assert.deepEqual(
    calls.map((call) => `${call.init.method ?? 'GET'} ${new URL(call.url).pathname}`),
    ['GET /status', 'GET /api/history/state', 'GET /api/config', 'POST /api/history/visits'],
  )
})

test('an instance that no longer accepts visits gets nothing, and the buffer goes', async () => {
  const { scripts, local } = setup(recordingStorage(3))
  const { fetch, calls } = stubFetch(instanceRoutes([{ status: 200 }], { ...ON, enabled: false }))

  await scripts.runHistoryRelay({
    fetch,
    origin: 'https://diele.example.com',
    send: channel(scripts),
  })

  assert.equal(calls.filter((call) => call.init.method === 'POST').length, 0)
  assert.equal(calls.filter((call) => call.url.endsWith('/api/config')).length, 0)
  assert.equal(local.dieleHistoryBuffer.visits.length, 0)
  assert.equal(
    scripts.historyStatusOf('one', local.dieleHistoryTarget, local.dieleHistoryState),
    'optIn',
  )
})

// Firefox registers the relay on every port of the host, so another app there must see nothing
test('a relay outside the target, another port included, requests nothing at all', async () => {
  for (const page of ['https://elsewhere.example/', 'https://diele.example.com:8443/']) {
    const { scripts, local } = setup(recordingStorage(3))
    const { fetch, calls } = stubFetch(instanceRoutes([{ status: 200 }]))

    const outcome = await scripts.runHistoryRelay({
      fetch,
      origin: new URL(page).origin,
      send: channel(scripts, page),
    })

    assert.equal(outcome, 'outside', page)
    assert.equal(calls.length, 0, page)
    assert.equal(local.dieleHistoryBuffer.visits.length, 3, page)
  }
})

// Firefox's `content.fetch` is manifest v2 only, and a `content` global on a page in v3 is
// whatever the page named that, an element or a frame
test('the relay fetches with the content script global fetch, never a `content` one', async () => {
  const { scripts } = setup({})
  const used = []
  const world = {
    Event,
    dispatchEvent: (event) => used.push(['event', event.type]),
    location: { origin: 'https://diele.example.com' },
    fetch: async (url) => {
      used.push(['fetch', url])
      return new Response('{}')
    },
    content: { fetch: async (url) => used.push(['content', url]) },
    chrome: { runtime: { sendMessage: async (message) => used.push(['send', message.kind]) } },
  }
  const deps = scripts.relayDepsOf(world)

  await deps.fetch('https://diele.example.com/status')
  await deps.send({ kind: 'history:ready' })
  deps.announce()

  assert.equal(deps.origin, 'https://diele.example.com')
  assert.deepEqual(used, [
    ['fetch', 'https://diele.example.com/status'],
    ['send', 'history:ready'],
    ['event', 'diele:history-delivered'],
  ])
})

test('an origin that does not answer like diele is asked nothing more, sent nothing', async () => {
  for (const status of [
    { status: 200, body: { healthy: true } },
    { status: 200, raw: '<!doctype html><html><body><div id="app"></div></body></html>' },
    { status: 502, raw: 'Bad Gateway' },
  ]) {
    const { scripts, local } = setup(recordingStorage(3))
    const before = structuredClone(local.dieleHistoryBuffer)
    const { fetch, calls } = stubFetch({ ...instanceRoutes([{ status: 200 }]), '/status': status })

    const outcome = await scripts.runHistoryRelay({
      fetch,
      origin: 'https://diele.example.com',
      send: channel(scripts),
    })

    assert.equal(outcome, 'unrecognised')
    assert.deepEqual(
      calls.map((call) => new URL(call.url).pathname),
      ['/status'],
    )
    assert.deepEqual(local.dieleHistoryBuffer, before)
    assert.equal(local.dieleHistoryState.unrecognised, true)
    assert.equal(local.dieleHistoryState.account, RECORDING.account)
    assert.equal(
      scripts.historyStatusOf('one', local.dieleHistoryTarget, local.dieleHistoryState),
      'unrecognised',
    )
  }
})

// A dev server that served its index page at /status, its proxy fixed between two loads
test('the next run that finds diele clears the mark and delivers what waited', async () => {
  const { scripts, local } = setup(recordingStorage(3))
  const html = { status: 200, raw: '<!doctype html>' }
  const routes = { ...instanceRoutes([{ status: 200 }]), '/status': [html, STATUS] }
  const { fetch } = stubFetch(routes)
  const deps = { fetch, origin: 'https://diele.example.com', send: channel(scripts) }

  assert.equal(await scripts.runHistoryRelay(deps), 'unrecognised')
  assert.equal(await scripts.runHistoryRelay(deps), 'delivered')

  assert.equal(local.dieleHistoryState.unrecognised, undefined)
  assert.equal(local.dieleHistoryBuffer.visits.length, 0)
  assert.equal(
    scripts.historyStatusOf('one', local.dieleHistoryTarget, local.dieleHistoryState),
    'recording',
  )
})

test('a fresh target waits until a relay first ran, unlike one that has', async () => {
  const { scripts, local } = setup({ dieleHistoryTarget: TARGET })
  const status = () =>
    scripts.historyStatusOf('one', local.dieleHistoryTarget, local.dieleHistoryState)

  assert.equal(status(), 'waiting')

  const unreachable = stubFetch({})
  await scripts.runHistoryRelay({
    fetch: unreachable.fetch,
    origin: 'https://diele.example.com',
    send: channel(scripts),
  })
  assert.equal(status(), 'waiting')

  const { fetch } = stubFetch(instanceRoutes([{ status: 200 }]))
  await scripts.runHistoryRelay({
    fetch,
    origin: 'https://diele.example.com',
    send: channel(scripts),
  })
  assert.equal(status(), 'recording')
})

// A command template can carry a key in its other parameters, and storage is plaintext on disk
test('only what a template needs to match reaches storage, never its other parameters', async () => {
  const { scripts, local } = setup(recordingStorage(0))
  const routes = instanceRoutes([{ status: 200 }])
  routes['/api/config'] = {
    status: 200,
    body: {
      engines: [{ urlTemplate: 'https://search.example.com/find?term={query}&key=s3cr3t-api-key' }],
      commands: [{ urlTemplate: 'https://wiki.example/w/{query}?token=another-s3cr3t' }],
    },
  }
  const { fetch } = stubFetch(routes)

  await scripts.runHistoryRelay({
    fetch,
    origin: 'https://diele.example.com',
    send: channel(scripts),
  })

  assert.doesNotMatch(JSON.stringify(local), /s3cr3t|key=|token=/)
  assert.deepEqual(local.dieleHistoryState.searchPatterns, [
    { host: 'search.example.com', port: '', path: '/find', param: 'term' },
    { host: 'wiki.example', port: '', path: '', prefix: '/w/' },
  ])

  await scripts.recordHistoryVisit('https://search.example.com/find?term=private', 'x', Date.now())
  await scripts.recordHistoryVisit('https://wiki.example/w/Private_Thing', 'x', Date.now())
  assert.equal(local.dieleHistoryBuffer.visits.length, 0)
})

// The buffer must never reach the page world, which a script of the page's own could read. What
// is allowed is a plain event without detail, telling the page to read its history, and of the
// page only whether it is visible, to send again when it is returned to.
test('the relay touches neither the DOM nor the page, but for its event and visibility', () => {
  const allowed = {
    'history/relay.js': [
      'world.dispatchEvent(new world.Event(HISTORY_DELIVERED_EVENT))',
      "world.document.addEventListener('visibilitychange', () => {",
      "world.document.visibilityState === 'visible'",
    ],
    'history/relayStart.js': [],
  }

  for (const [file, uses] of Object.entries(allowed)) {
    let source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')

    for (const use of uses) {
      assert.equal(source.split(use).length - 1, 1, `${file}: ${use}`)
      source = source.replace(use, '')
    }

    assert.doesNotMatch(
      source,
      /\b(document|window|postMessage|localStorage|sessionStorage|dispatchEvent|addEventListener|visibilityState|CustomEvent|innerHTML|querySelector)\b/,
      file,
    )
  }

  const source = readFileSync(new URL('../history/relay.js', import.meta.url), 'utf8')
  assert.match(source, /const HISTORY_DELIVERED_EVENT = 'diele:history-delivered'\n/)
})

/**
 * Wraps a fetch so every answer arrives a little later, the way two tabs' requests interleave.
 * @param {Function} fetch - The fetch to delay
 * @returns {Function} - The delayed fetch
 */
function slowly(fetch) {
  return async (url, init) => {
    await new Promise((resolve) => setTimeout(resolve, 5))
    return fetch(url, init)
  }
}

// diele is often the new tab page, so two of its tabs loading at once is ordinary
test('two diele tabs loading at once post every visit exactly once', async () => {
  const { scripts, local } = setup(recordingStorage(250))
  const { fetch, calls } = stubFetch(instanceRoutes([{ status: 200 }, { status: 200 }]))
  const deps = { fetch: slowly(fetch), origin: 'https://diele.example.com', send: channel(scripts) }

  const outcomes = await Promise.all([scripts.runHistoryRelay(deps), scripts.runHistoryRelay(deps)])

  const posted = calls
    .filter((call) => call.init.method === 'POST')
    .flatMap((call) => JSON.parse(call.init.body).visits.map((visit) => visit.url))

  assert.deepEqual([...outcomes].sort(), ['delivered', 'idle'])
  assert.equal(posted.length, 250)
  assert.equal(new Set(posted).size, 250)
  assert.equal(local.dieleHistoryBuffer.visits.length, 0)
  assert.equal(local.dieleHistoryLease, undefined)
})

test('a batch is leased: a second report gets nothing until the first settles', async () => {
  const { scripts, local } = setup(recordingStorage(3))
  const send = channel(scripts)
  const report = { kind: 'history:report', signedIn: true, state: ON, engineTemplates: [] }

  const first = await send(report)
  const second = await send(report)

  assert.equal(first.visits.length, 3)
  assert.equal(typeof first.lease, 'string')
  assert.equal(second.visits.length, 0)

  await send({ kind: 'history:release', lease: 'someone-else' })
  assert.equal((await send(report)).visits.length, 0)

  await send({ kind: 'history:release', lease: first.lease })
  assert.equal((await send(report)).visits.length, 3)
  assert.ok(local.dieleHistoryLease)
})

test('a lease that ran out is free again, and its holder hands nothing on', async () => {
  const stored = recordingStorage(3)
  const { scripts, local } = setup(stored)
  const send = channel(scripts)
  const report = { kind: 'history:report', signedIn: true, state: ON, engineTemplates: [] }

  const first = await send(report)
  local.dieleHistoryLease = { ...local.dieleHistoryLease, until: Date.now() - 1 }

  const second = await send(report)
  assert.equal(second.visits.length, 3)
  assert.notEqual(second.lease, first.lease)

  const sent = first.visits.map((visit) => ({ url: visit.url, at: visit.at }))
  const late = await send({ kind: 'history:settled', visits: sent, lease: first.lease, more: true })

  assert.equal(late.visits.length, 0)
  assert.equal(local.dieleHistoryLease.id, second.lease)
  assert.equal(local.dieleHistoryBuffer.visits.length, 0)
})

// Only a clock set back can leave a lease that far ahead, and it must not lock the buffer for good
test('a lease further ahead than any is granted for holds nothing', async () => {
  const { scripts, local } = setup(recordingStorage(3))
  local.dieleHistoryLease = { id: 'stuck', until: Date.now() + 24 * 60 * 60_000 }

  const reply = await channel(scripts)({
    kind: 'history:report',
    signedIn: true,
    state: ON,
    engineTemplates: [],
  })

  assert.equal(reply.visits.length, 3)
})

test('the last round of a load leaves no lease behind', async () => {
  const { scripts, local } = setup(recordingStorage(500))
  const routes = instanceRoutes([{ status: 200 }, { status: 200 }, { status: 200 }])
  const { fetch, calls } = stubFetch(routes)

  await scripts.runHistoryRelay({
    fetch,
    origin: 'https://diele.example.com',
    send: channel(scripts),
  })

  assert.equal(calls.filter((call) => call.init.method === 'POST').length, 3)
  assert.equal(local.dieleHistoryBuffer.visits.length, 0)
  assert.equal(local.dieleHistoryLease, undefined)
})

test('a refusal and a change of account both drop the lease with the buffer', async () => {
  const refused = setup(recordingStorage(3))
  const { fetch } = stubFetch(instanceRoutes([{ status: 403 }]))

  await refused.scripts.runHistoryRelay({
    fetch,
    origin: 'https://diele.example.com',
    send: channel(refused.scripts),
  })
  assert.equal(refused.local.dieleHistoryLease, undefined)

  const switched = setup({
    ...recordingStorage(3),
    dieleHistoryLease: { id: 'theirs', until: Date.now() + 10_000 },
  })
  const reply = await channel(switched.scripts)({
    kind: 'history:report',
    signedIn: true,
    state: { ...ON, account: 'other' },
    engineTemplates: [],
  })

  assert.equal(reply.visits.length, 0)
  assert.equal(switched.local.dieleHistoryLease, undefined)
})

/**
 * Runs the relay with a page that records every event dispatched to it.
 * @param {object} local - What chrome.storage.local starts with
 * @param {object} routes - What the instance answers
 * @returns {Promise<{outcome: string, events: Event[], order: string[]}>} - How the run ended,
 *   what the page got, and every message and event in the order they went out
 */
async function announced(local, routes) {
  const { scripts } = setup(local)
  const { fetch } = stubFetch(routes)
  const send = channel(scripts)
  const events = []
  const order = []
  const world = {
    Event,
    location: { origin: 'https://diele.example.com' },
    fetch,
    dispatchEvent: (event) => {
      order.push('event')
      events.push(event)
    },
    chrome: {
      runtime: {
        sendMessage: (message) => {
          order.push(message.kind)
          return send(message)
        },
      },
    },
  }

  const outcome = await scripts.runHistoryRelay(scripts.relayDepsOf(world))
  return { outcome, events, order }
}

test('a delivered run tells the page once, after the last batch, and nothing more', async () => {
  const { outcome, events, order } = await announced(
    recordingStorage(250),
    instanceRoutes([{ status: 200 }, { status: 200 }]),
  )

  assert.equal(outcome, 'delivered')
  assert.deepEqual(order.slice(-3), ['history:settled', 'history:settled', 'event'])
  assert.equal(events.length, 1)
  assert.equal(events[0].constructor, Event)
  assert.equal(events[0].type, 'diele:history-delivered')
  assert.equal('detail' in events[0], false)
  assert.deepEqual(Object.keys(events[0]), [])
  assert.equal(events[0].bubbles, false)
})

test('a run that delivered nothing never tells the page', async () => {
  const html = { status: 200, raw: '<!doctype html>' }

  for (const [label, local, routes] of [
    ['idle', recordingStorage(0), instanceRoutes([{ status: 200 }])],
    ['kept', recordingStorage(3), instanceRoutes([{ status: 429 }])],
    ['refused', recordingStorage(3), instanceRoutes([{ status: 403 }])],
    ['unrecognised', recordingStorage(3), { ...instanceRoutes([]), '/status': html }],
    ['offline', recordingStorage(3), {}],
    ['outside', {}, instanceRoutes([{ status: 200 }])],
  ]) {
    const { outcome, events } = await announced(local, routes)

    assert.equal(outcome, label)
    assert.equal(events.length, 0, label)
  }
})

// A batch the server could not read is dropped, but nothing new reached the page's history
test('a run whose only batch the server refused to read does not tell the page', async () => {
  const { outcome, events } = await announced(
    recordingStorage(3),
    instanceRoutes([{ status: 400 }]),
  )

  assert.equal(outcome, 'delivered')
  assert.equal(events.length, 0)
})

// The first batch is stored even though the second waits, so the page has something to show
test('a run that delivered a batch before one was kept still tells the page once', async () => {
  const { outcome, events } = await announced(
    recordingStorage(250),
    instanceRoutes([{ status: 200 }, { status: 429 }]),
  )

  assert.equal(outcome, 'kept')
  assert.equal(events.length, 1)
})
