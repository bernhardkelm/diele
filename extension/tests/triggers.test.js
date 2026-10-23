import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ACCOUNT, INSTANCE, ON, RECORDING, TARGET, setup } from './worker.js'

const STATUS = { status: 'ok', version: '0.2.2' }

/**
 * Builds a fetch that answers as an instance that accepts visits, counting what it was asked.
 * @param {Promise<void>} [hold] - Settles before any answer leaves, to keep a run in flight
 * @returns {{fetch: Function, paths: string[]}} - The stub and the paths requested
 */
function instance(hold = Promise.resolve()) {
  const paths = []
  const bodies = {
    '/status': STATUS,
    '/api/history/state': { ...ON, excludedDomains: [], kept: 0 },
    '/api/config': { engines: [], commands: [] },
    '/api/history/visits': { ok: true },
  }

  const fetch = async (url) => {
    const path = new URL(url).pathname
    paths.push(path)
    await hold
    return new Response(JSON.stringify(bodies[path] ?? {}), { status: 200 })
  }

  return { fetch, paths }
}

/**
 * Loads the worker and a relay tab beside it: the content script's page, with its visibility, and
 * its listeners, which the test fires by hand.
 * @param {object} local - What chrome.storage.local starts with
 * @param {Promise<void>} [hold] - Keeps every request of the instance pending until it settles
 * @returns {object} - The scope, storage, the trigger, the page and what reached the worker
 */
function relayTab(local, hold) {
  const { scripts } = setup(local)
  const { fetch, paths } = instance(hold)
  const sender = { id: 'ext', url: `${INSTANCE}#/`, frameId: 0, tab: { id: 3, incognito: false } }
  const kinds = []
  const send = (message) =>
    new Promise((resolve) => {
      kinds.push(message.kind)
      if (!scripts.onHistoryMessage(structuredClone(message), sender, resolve)) {
        resolve(undefined)
      }
    })
  const clock = { now: 0 }
  const page = { visibilityState: 'hidden', listeners: [] }
  const messages = []
  const world = {
    document: {
      get visibilityState() {
        return page.visibilityState
      },
      addEventListener: (type, listener) => page.listeners.push([type, listener]),
    },
    chrome: { runtime: { id: 'ext', onMessage: { addListener: (fn) => messages.push(fn) } } },
  }
  const trigger = scripts.relayTriggerOf(
    { fetch, origin: 'https://diele.example.com', send, announce: () => undefined },
    () => clock.now,
  )

  scripts.listenForRelayTriggers(world, trigger)

  return { scripts, local, trigger, page, messages, clock, kinds, paths }
}

/**
 * Starts from a browser that recorded for the account and has a visit waiting.
 * @returns {object} - chrome.storage.local's contents
 */
function waiting() {
  return {
    dieleHistoryTarget: TARGET,
    dieleHistoryState: RECORDING,
    dieleHistoryBuffer: {
      instance: INSTANCE,
      account: ACCOUNT,
      visits: [{ url: 'https://heise.de/', at: new Date(Date.now() - 60_000).toISOString() }],
    },
  }
}

/**
 * Lets the relay's promise chains run to the end.
 * @returns {Promise<void>}
 */
async function flush() {
  for (let turn = 0; turn < 20; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

/**
 * Shows or hides the page, firing its visibilitychange listeners the way the browser does.
 * @param {{visibilityState: string, listeners: Array<[string, Function]>}} page - The page
 * @param {'visible' | 'hidden'} state - What it becomes
 * @returns {void}
 */
function show(page, state) {
  page.visibilityState = state

  for (const [type, listener] of page.listeners) {
    if (type === 'visibilitychange') {
      listener()
    }
  }
}

/**
 * Delivers a message to the content script's listeners, the way tabs.sendMessage does.
 * @param {Function[]} listeners - The content script's onMessage listeners
 * @param {object} message - What is sent
 * @param {object} sender - Who sends it
 * @returns {{answered: unknown[], kept: boolean[]}} - Every reply, and what each listener returned
 */
function deliver(listeners, message, sender) {
  const answered = []
  const kept = listeners.map((listener) =>
    listener(message, sender, (reply) => answered.push(reply)),
  )

  return { answered, kept }
}

test('becoming visible runs the relay, at most once in ten seconds', async () => {
  const tab = relayTab(waiting())

  show(tab.page, 'visible')
  await flush()
  assert.equal(tab.local.dieleHistoryBuffer.visits.length, 0)
  assert.equal(tab.paths.filter((path) => path === '/api/history/visits').length, 1)

  tab.local.dieleHistoryBuffer = waiting().dieleHistoryBuffer
  tab.clock.now = 9_000
  show(tab.page, 'hidden')
  show(tab.page, 'visible')
  await flush()
  assert.equal(tab.paths.filter((path) => path === '/api/history/visits').length, 1)

  tab.clock.now = 10_000
  show(tab.page, 'visible')
  await flush()
  assert.equal(tab.paths.filter((path) => path === '/api/history/visits').length, 2)
})

test('hiding the page runs nothing', async () => {
  const tab = relayTab(waiting())

  show(tab.page, 'hidden')
  await flush()

  assert.deepEqual(tab.kinds, [])
  assert.deepEqual(tab.paths, [])
})

test('a run never starts while another is in flight in the same tab', async () => {
  let release
  const tab = relayTab(waiting(), new Promise((resolve) => (release = resolve)))

  const first = tab.trigger('load')
  await flush()
  const second = await tab.trigger('load')
  tab.clock.now = 60_000
  show(tab.page, 'visible')
  deliver(tab.messages, { kind: 'history:flush' }, { id: 'ext' })

  release()
  assert.equal(await first, 'delivered')
  assert.equal(second, 'busy')
  assert.equal(tab.kinds.filter((kind) => kind === 'history:ready').length, 1)
  assert.equal(tab.paths.filter((path) => path === '/api/history/visits').length, 1)
})

test('a page load always runs, inside the throttle too', async () => {
  const tab = relayTab(waiting())

  assert.equal(await tab.trigger('visible'), 'delivered')
  tab.clock.now = 1_000
  assert.equal(await tab.trigger('visible'), 'throttled')
  assert.equal(await tab.trigger('load'), 'idle')
})

test('a flush from the worker runs the relay, answered at once', async () => {
  const tab = relayTab(waiting())

  const { answered, kept } = deliver(tab.messages, { kind: 'history:flush' }, { id: 'ext' })
  await flush()

  assert.deepEqual(
    answered.map((reply) => ({ ...reply })),
    [{ ok: true }],
  )
  assert.deepEqual(kept, [false])
  assert.equal(tab.local.dieleHistoryBuffer.visits.length, 0)
})

test('a flush from a tab, another extension or of another kind is ignored', async () => {
  for (const [label, message, sender] of [
    ['a content script', { kind: 'history:flush' }, { id: 'ext', tab: { id: 9 } }],
    ['another extension', { kind: 'history:flush' }, { id: 'intruder' }],
    ['no sender', { kind: 'history:flush' }, undefined],
    ['another kind', { kind: 'history:ready' }, { id: 'ext' }],
    ['no message', null, { id: 'ext' }],
  ]) {
    const tab = relayTab(waiting())
    const { answered, kept } = deliver(tab.messages, message, sender)
    await flush()

    assert.deepEqual(answered, [], label)
    assert.deepEqual(kept, [false], label)
    assert.deepEqual(tab.kinds, [], label)
    assert.equal(tab.local.dieleHistoryBuffer.visits.length, 1, label)
  }
})

test('a tab returned to or nudged asks the instance nothing while nothing is due', async () => {
  const tab = relayTab({ ...waiting(), dieleHistoryBuffer: { instance: INSTANCE, visits: [] } })

  deliver(tab.messages, { kind: 'history:flush' }, { id: 'ext' })
  await flush()

  assert.deepEqual(tab.kinds, ['history:ready'])
  assert.deepEqual(tab.paths, [])
})

test('an instance not heard from yet is due even with nothing waiting', async () => {
  const tab = relayTab({ dieleHistoryTarget: TARGET })

  show(tab.page, 'visible')
  await flush()

  assert.deepEqual(tab.paths.slice(0, 2), ['/status', '/api/history/state'])
  assert.equal(tab.local.dieleHistoryState.instance, INSTANCE)
})
