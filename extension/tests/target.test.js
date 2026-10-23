import assert from 'node:assert/strict'
import { test } from 'node:test'
import { INSTANCE, RECORDING, TARGET, fakeBrowser, setup } from './worker.js'

const ORIGIN = `${INSTANCE}*`
const OTHER = 'https://work.example.org/'
const API = ['webNavigation', 'scripting']

/**
 * Builds the synced list with a second instance beside the first.
 * @returns {object} - chrome.storage.sync's contents
 */
function twoInstances() {
  return {
    dieleInstances: [
      { id: 'one', name: '', url: INSTANCE },
      { id: 'two', name: 'work', url: OTHER },
    ],
    dieleActiveId: 'one',
  }
}

/**
 * Starts from a browser where history records for the first instance, its relay registered.
 * @param {{titles?: boolean, sync?: object}} [options] - Whether titles are on, and the synced list
 * @returns {object} - What setup returns, with the browser's holdings as `held`
 */
function recordingBrowser(options = {}) {
  const { held, parts } = fakeBrowser({
    permissions: [...API, ...(options.titles ? ['tabs'] : [])],
    origins: [ORIGIN],
    registered: [{ id: 'diele-history-relay', matches: [ORIGIN] }],
  })
  const world = setup(
    {
      dieleHistoryTarget: { ...TARGET, titles: options.titles === true },
      dieleHistoryState: RECORDING,
      dieleHistoryBuffer: { instance: INSTANCE, account: RECORDING.account, visits: [] },
    },
    { chrome: parts, target: true, sync: options.sync },
  )

  return { ...world, held }
}

// Firefox clears registered content scripts when the extension is updated or reloaded
test('the relay is registered again for the stored target after an update', async () => {
  const { held, parts } = fakeBrowser({ permissions: API, origins: [ORIGIN] })
  const { scripts } = setup({ dieleHistoryTarget: TARGET }, { chrome: parts, target: true })

  await scripts.restoreHistoryRelay()
  await scripts.restoreHistoryRelay()

  assert.equal(held.registered.length, 1)
  assert.equal(held.registered[0].id, 'diele-history-relay')
  assert.deepEqual(held.registered[0].matches, [ORIGIN])
  assert.deepEqual(held.registered[0].js, ['history/relay.js', 'history/relayStart.js'])
})

test('a target whose permissions went is switched off rather than restored', async () => {
  const { held, parts } = fakeBrowser()
  const { scripts, local } = setup({ dieleHistoryTarget: TARGET }, { chrome: parts, target: true })

  await scripts.restoreHistoryRelay()

  assert.equal(held.registered.length, 0)
  assert.equal(local.dieleHistoryTarget, undefined)
})

test('nothing is registered without a target', async () => {
  const { held, parts } = fakeBrowser({ permissions: API, origins: [ORIGIN] })
  const { scripts } = setup({}, { chrome: parts, target: true })

  await scripts.restoreHistoryRelay()

  assert.equal(held.registered.length, 0)
})

test('switching on sets the target, registers the relay and keeps its origin alone', async () => {
  const { held, parts } = fakeBrowser({
    permissions: [...API, 'tabs'],
    origins: [ORIGIN, 'https://work.example.org/*'],
  })
  const { scripts, local } = setup(
    {
      dieleHistoryPending: { id: 'one', at: Date.now(), kind: 'history' },
      dieleHistoryLease: { id: 'stale', until: Date.now() + 10_000 },
    },
    { chrome: parts, target: true, sync: twoInstances() },
  )

  assert.equal(await scripts.activateHistory('one'), 'active')

  assert.deepEqual({ ...local.dieleHistoryTarget }, { id: 'one', url: INSTANCE, titles: false })
  assert.equal(local.dieleHistoryPending, undefined)
  assert.equal(local.dieleHistoryLease, undefined)
  assert.deepEqual(
    held.registered.map((script) => script.matches),
    [[ORIGIN]],
  )
  assert.deepEqual([...held.origins], [ORIGIN])
  assert.deepEqual([...held.permissions].sort(), [...API].sort())
})

test('switching off clears everything stored and gives every permission back', async () => {
  const { scripts, local, held } = recordingBrowser({ titles: true })
  local.dieleHistoryPending = { id: 'one', at: Date.now(), kind: 'titles' }
  local.dieleHistoryLease = { id: 'held', until: Date.now() + 10_000 }

  await scripts.deactivateHistory()

  assert.deepEqual(Object.keys(local), [])
  assert.equal(held.registered.length, 0)
  assert.equal(held.permissions.size, 0)
  assert.equal(held.origins.size, 0)
})

test('a relay the browser will not register leaves history off, nothing granted', async () => {
  const { held, parts } = fakeBrowser({
    permissions: API,
    origins: [ORIGIN],
    failRegister: true,
  })
  const { scripts, local } = setup(
    { dieleHistoryPending: { id: 'one', at: Date.now(), kind: 'history' } },
    { chrome: parts, target: true },
  )

  assert.equal(await scripts.activateHistory('one'), 'failed')

  assert.deepEqual(Object.keys(local), [])
  assert.equal(held.permissions.size, 0)
  assert.equal(held.origins.size, 0)
})

test('the popup is told whether switching on failed or was never possible', async () => {
  const failing = fakeBrowser({ permissions: API, origins: [ORIGIN], failRegister: true })
  const failed = setup({}, { chrome: failing.parts, target: true })
  const reply = await failed.scripts.answerPopup({ kind: 'history:activate', id: 'one' })

  assert.equal(reply.active, false)
  assert.equal(reply.outcome, 'failed')

  const bare = fakeBrowser()
  const refused = setup({}, { chrome: bare.parts, target: true })
  const answer = await refused.scripts.answerPopup({ kind: 'history:activate', id: 'one' })

  assert.equal(answer.outcome, 'refused')
})

test('a grant for an instance that is gone goes back, the target keeping its own', async () => {
  const lone = fakeBrowser({ permissions: API, origins: ['https://work.example.org/*'] })
  const nothing = setup(
    { dieleHistoryPending: { id: 'gone', at: Date.now(), kind: 'history' } },
    { chrome: lone.parts, target: true },
  )

  assert.equal(await nothing.scripts.activateHistory('gone'), 'refused')
  assert.equal(nothing.local.dieleHistoryPending, undefined)
  assert.equal(lone.held.permissions.size, 0)
  assert.equal(lone.held.origins.size, 0)

  const { scripts, local, held } = recordingBrowser()
  held.origins.add('https://work.example.org/*')

  assert.equal(await scripts.activateHistory('gone'), 'refused')
  assert.equal(local.dieleHistoryTarget.id, 'one')
  assert.deepEqual([...held.origins], [ORIGIN])
  assert.deepEqual([...held.permissions].sort(), [...API].sort())
})

test('titles go on for the target once tabs is held', async () => {
  const { scripts, local, held } = recordingBrowser()
  held.permissions.add('tabs')

  assert.equal(await scripts.enableHistoryTitles('one'), true)
  assert.equal(local.dieleHistoryTarget.titles, true)
  assert.equal(held.permissions.has('tabs'), true)
})

test('titles refused for an instance that is not the target give tabs back', async () => {
  const { scripts, local, held } = recordingBrowser()
  held.permissions.add('tabs')
  local.dieleHistoryPending = { id: 'two', at: Date.now(), kind: 'titles' }

  assert.equal(await scripts.enableHistoryTitles('two'), false)
  assert.equal(local.dieleHistoryTarget.titles, false)
  assert.equal(local.dieleHistoryPending, undefined)
  assert.equal(held.permissions.has('tabs'), false)

  const off = fakeBrowser({ permissions: ['tabs'] })
  const untargeted = setup({}, { chrome: off.parts, target: true })

  assert.equal(await untargeted.scripts.enableHistoryTitles('one'), false)
  assert.equal(off.held.permissions.has('tabs'), false)
})

test('a refused titles prompt for another row leaves titles already on alone', async () => {
  const { scripts, local, held } = recordingBrowser({ titles: true })

  assert.equal(await scripts.enableHistoryTitles('two'), false)
  assert.equal(local.dieleHistoryTarget.titles, true)
  assert.equal(held.permissions.has('tabs'), true)
})

test('the target removed from the synced list switches history off', async () => {
  const { scripts, local, held, sync } = recordingBrowser({ sync: twoInstances() })
  sync.dieleInstances = sync.dieleInstances.filter((instance) => instance.id !== 'one')

  await scripts.checkHistoryTarget()

  assert.equal(local.dieleHistoryTarget, undefined)
  assert.equal(local.dieleHistoryBuffer, undefined)
  assert.equal(held.registered.length, 0)
  assert.equal(held.origins.size, 0)
})

test('the target given another address on a synced browser switches history off', async () => {
  const { scripts, local, held, sync } = recordingBrowser({ sync: twoInstances() })
  sync.dieleInstances[0] = { ...sync.dieleInstances[0], url: 'https://moved.example.com/' }

  await scripts.checkHistoryTarget()

  assert.equal(local.dieleHistoryTarget, undefined)
  assert.equal(held.registered.length, 0)
  assert.equal(held.permissions.size, 0)
})

test('an unrelated change to the synced list leaves history on', async () => {
  const { scripts, local, held, sync } = recordingBrowser({ sync: twoInstances() })
  sync.dieleInstances[1] = { ...sync.dieleInstances[1], name: 'renamed' }
  sync.dieleActiveId = 'two'

  await scripts.checkHistoryTarget()

  assert.equal(local.dieleHistoryTarget.id, 'one')
  assert.equal(held.registered.length, 1)
})

test('tabs revoked in the browser switches titles off and nothing else', async () => {
  const { scripts, local, held } = recordingBrowser({ titles: true })
  held.permissions.delete('tabs')

  await scripts.checkHistoryTarget()

  assert.equal(local.dieleHistoryTarget.titles, false)
  assert.equal(held.registered.length, 1)
  assert.deepEqual([...held.origins], [ORIGIN])
})

test('a pending switch is finished from the prompt only while it is fresh', async () => {
  const now = Date.now()

  for (const [at, expected] of [
    [now - 60_000, 'one'],
    [now - 11 * 60_000, undefined],
    ['soon', undefined],
  ]) {
    const { held, parts } = fakeBrowser({ permissions: API, origins: [ORIGIN] })
    const { scripts, local } = setup(
      { dieleHistoryPending: { id: 'one', at, kind: 'history' } },
      { chrome: parts, target: true },
    )

    await scripts.resumePendingHistory()

    assert.equal(local.dieleHistoryTarget?.id, expected, String(at))
    assert.equal(held.registered.length, expected ? 1 : 0, String(at))
  }
})

test('a fresh pending titles switch turns titles on, a stale one does not', async () => {
  for (const [ago, expected] of [
    [60_000, true],
    [11 * 60_000, false],
  ]) {
    const { scripts, local, held } = recordingBrowser()
    held.permissions.add('tabs')
    local.dieleHistoryPending = { id: 'one', at: Date.now() - ago, kind: 'titles' }

    await scripts.resumePendingHistory()

    assert.equal(local.dieleHistoryTarget.titles, expected, String(ago))
  }
})
