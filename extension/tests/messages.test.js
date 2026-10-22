import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ACCOUNT, INSTANCE, ON, RECORDING, TARGET, fakeBrowser, setup } from './worker.js'

const ORIGIN = `${INSTANCE}*`
const VISITS = [
  { url: 'https://docs.example.com/guide', at: new Date(Date.now() - 60_000).toISOString() },
  { url: 'https://wiki.example.org/page', at: new Date(Date.now() - 120_000).toISOString() },
]

// Every message, each with what would change something if it were let through
const RELAY_MESSAGES = {
  'history:ready': {},
  'history:report': {
    signedIn: true,
    state: { ...ON, account: 'intruder' },
    engineTemplates: [],
  },
  'history:settled': { visits: VISITS, lease: 'held', more: true },
  'history:release': { lease: 'held' },
  'history:renew': { lease: 'held' },
  'history:unrecognised': {},
  'history:refused': {},
}
const POPUP_MESSAGES = {
  'history:activate': { id: 'two' },
  'history:deactivate': {},
  'history:titles': { id: 'one' },
  'history:untitled': {},
}

const RELAY = { id: 'ext', url: `${INSTANCE}#/`, frameId: 0, tab: { id: 3, incognito: false } }
const POPUP = { id: 'ext', url: 'chrome-extension://ext/popup.html' }

// Who may not speak as the relay: the extension's own pages, another extension, a sender with no
// tab, an incognito tab, a frame, and pages beside the target, on another port included
const NOT_RELAY = {
  'the popup': POPUP,
  'the options page in a tab': { ...POPUP, tab: { id: 9, incognito: false }, frameId: 0 },
  'another extension': { ...RELAY, id: 'intruder' },
  'a sender without a tab': { id: 'ext', url: `${INSTANCE}#/`, frameId: 0 },
  'an incognito tab': { ...RELAY, tab: { id: 3, incognito: true } },
  'a frame': { ...RELAY, frameId: 2 },
  'another site': { ...RELAY, url: 'https://elsewhere.example/' },
  'another port of the instance': { ...RELAY, url: 'https://diele.example.com:8443/' },
  'a host that only starts like the instance': {
    ...RELAY,
    url: 'https://diele.example.com.evil.example/',
  },
}

// Who may not switch anything: the relay on the instance, another extension's page, and a content
// script anywhere
const NOT_POPUP = {
  'the relay on the instance': RELAY,
  'another extension': { id: 'intruder', url: 'chrome-extension://intruder/popup.html' },
  'another extension posing with this url': { id: 'intruder', url: POPUP.url },
  'a content script on a web page': { ...RELAY, url: 'https://elsewhere.example/' },
  'a sender with no url': { id: 'ext' },
}

/**
 * Starts from a browser that records for the target, with a buffer and a lease on it.
 * @returns {object} - What setup returns, with the browser's holdings as `held`
 */
function recording() {
  const { held, parts } = fakeBrowser({
    permissions: ['webNavigation', 'scripting', 'tabs'],
    origins: [ORIGIN],
    registered: [{ id: 'diele-history-relay', matches: [ORIGIN] }],
  })
  const world = setup(
    {
      dieleHistoryTarget: { ...TARGET, titles: true },
      dieleHistoryState: RECORDING,
      dieleHistoryBuffer: { instance: INSTANCE, account: ACCOUNT, visits: VISITS },
      dieleHistoryLease: { id: 'held', until: Date.now() + 10_000 },
    },
    {
      chrome: parts,
      target: true,
      sync: {
        dieleInstances: [
          { id: 'one', name: '', url: INSTANCE },
          { id: 'two', name: '', url: 'https://work.example.org/' },
        ],
        dieleActiveId: 'one',
      },
    },
  )

  return { ...world, held }
}

/**
 * Delivers a message to the worker's listener the way the runtime does.
 * @param {object} scripts - The loaded scope
 * @param {object} message - What is sent
 * @param {object} sender - Who sends it
 * @returns {Promise<{handled: boolean, reply?: unknown}>} - Whether an answer was promised, and it
 */
function deliver(scripts, message, sender) {
  return new Promise((resolve) => {
    const handled = scripts.onHistoryMessage(structuredClone(message), sender, (reply) =>
      resolve({ handled: true, reply }),
    )

    if (!handled) {
      resolve({ handled: false })
    }
  })
}

/**
 * Captures everything a message could change: storage and what the browser holds.
 * @param {{local: object, held: object}} world - The live storage and holdings
 * @returns {string} - A comparable snapshot
 */
function snapshot(world) {
  return JSON.stringify({
    local: world.local,
    permissions: [...world.held.permissions].sort(),
    origins: [...world.held.origins].sort(),
    registered: world.held.registered,
  })
}

test('no relay message is acted on from anyone but the relay on the target', async () => {
  for (const [kind, body] of Object.entries(RELAY_MESSAGES)) {
    for (const [who, sender] of Object.entries(NOT_RELAY)) {
      const world = recording()
      const before = snapshot(world)
      const { handled, reply } = await deliver(world.scripts, { kind, ...body }, sender)
      const label = `${kind} from ${who}`

      assert.equal(snapshot(world), before, label)

      if (sender.url?.startsWith('chrome-extension://ext/')) {
        assert.equal(handled, false, label)
      } else if (kind === 'history:ready') {
        assert.equal(reply.inScope, false, label)
      } else {
        assert.equal(reply.visits.length, 0, label)
        assert.equal(reply.lease, undefined, label)
      }
    }
  }
})

test('no popup message is acted on from anything but the extension own pages', async () => {
  for (const [kind, body] of Object.entries(POPUP_MESSAGES)) {
    for (const [who, sender] of Object.entries(NOT_POPUP)) {
      const world = recording()
      const before = snapshot(world)
      const { handled } = await deliver(world.scripts, { kind, ...body }, sender)

      assert.equal(handled, false, `${kind} from ${who}`)
      assert.equal(snapshot(world), before, `${kind} from ${who}`)
    }
  }
})

test('the same messages from where they belong do act', async () => {
  const refused = recording()
  const answer = await deliver(refused.scripts, { kind: 'history:refused' }, RELAY)
  assert.equal(answer.handled, true)
  assert.equal(refused.local.dieleHistoryBuffer, undefined)

  const ready = recording()
  assert.equal((await deliver(ready.scripts, { kind: 'history:ready' }, RELAY)).reply.inScope, true)

  const unrecognised = recording()
  await deliver(unrecognised.scripts, { kind: 'history:unrecognised' }, RELAY)
  assert.equal(unrecognised.local.dieleHistoryState.unrecognised, true)
  assert.equal(unrecognised.local.dieleHistoryBuffer.visits.length, 2)

  const released = recording()
  await deliver(released.scripts, { kind: 'history:release', lease: 'held' }, RELAY)
  assert.equal(released.local.dieleHistoryLease, undefined)

  const off = recording()
  const reply = await deliver(off.scripts, { kind: 'history:deactivate' }, POPUP)
  assert.equal(reply.reply.active, false)
  assert.equal(off.local.dieleHistoryTarget, undefined)

  const untitled = recording()
  await deliver(untitled.scripts, { kind: 'history:untitled' }, POPUP)
  assert.equal(untitled.local.dieleHistoryTarget.titles, false)
  assert.equal(untitled.held.permissions.has('tabs'), false)
})

test('a message of no known kind, or no message at all, is left unanswered', async () => {
  const world = recording()
  const before = snapshot(world)

  for (const message of [null, 'history:refused', { kind: 'history:other' }, {}, []]) {
    for (const sender of [RELAY, POPUP]) {
      const { handled } = await deliver(world.scripts, message, sender)
      assert.equal(handled, false, JSON.stringify(message))
    }
  }

  assert.equal(snapshot(world), before)
})

test('a popup message with an id of the wrong shape switches nothing', async () => {
  for (const kind of ['history:activate', 'history:titles']) {
    for (const id of [undefined, 1, { id: 'one' }]) {
      const world = recording()
      const before = snapshot(world)
      const { reply } = await deliver(world.scripts, { kind, id }, POPUP)

      assert.equal(reply, undefined, `${kind} ${JSON.stringify(id)}`)
      assert.equal(snapshot(world), before, `${kind} ${JSON.stringify(id)}`)
    }
  }
})
