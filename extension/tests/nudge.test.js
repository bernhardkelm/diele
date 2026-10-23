import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { INSTANCE, RECORDING, TARGET, fakeBrowser, setup } from './worker.js'

/**
 * Lets the worker's promise chains run to the end.
 * @returns {Promise<void>}
 */
async function flush() {
  for (let turn = 0; turn < 20; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

/**
 * Has a relay in a tab say it is on the target's page.
 * @param {object} scripts - The loaded scope
 * @param {number} tabId - The relay's tab
 * @param {string} [url] - The page it runs on
 * @returns {Promise<unknown>} - The worker's reply
 */
function ready(scripts, tabId, url = `${INSTANCE}#/`) {
  const sender = { id: 'ext', url, frameId: 0, tab: { id: tabId, incognito: false } }

  return new Promise((resolve) => {
    scripts.onHistoryMessage({ kind: 'history:ready' }, sender, resolve)
  })
}

/**
 * Records a burst of visits, a moment apart.
 * @param {object} scripts - The loaded scope
 * @param {number} count - How many
 * @returns {Promise<void>}
 */
async function browse(scripts, count) {
  for (let index = 0; index < count; index += 1) {
    await scripts.recordHistoryVisit(`https://site${index}.example/`, undefined, Date.now())
    mock.timers.tick(1000)
  }
}

test('a relay on the target page is remembered by its tab, one elsewhere is not', async () => {
  const { scripts, session } = setup({ dieleHistoryTarget: TARGET })

  await ready(scripts, 3)
  await ready(scripts, 3)
  await ready(scripts, 4)
  await ready(scripts, 5, 'https://elsewhere.example/')

  assert.deepEqual([...session.dieleHistoryTabs], [3, 4])
})

test('a burst of visits nudges each known diele tab once, 5 s after the last', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const { scripts, nudged } = setup({ dieleHistoryTarget: TARGET, dieleHistoryState: RECORDING })

  await ready(scripts, 3)
  await ready(scripts, 4)
  await browse(scripts, 4)

  mock.timers.tick(3999)
  await flush()
  assert.deepEqual(nudged, [])

  mock.timers.tick(1)
  await flush()
  assert.deepEqual([...nudged].sort(), [3, 4])

  mock.timers.tick(60_000)
  await flush()
  assert.equal(nudged.length, 2)
  mock.timers.reset()
})

test('a tab that no longer answers is forgotten, the others kept', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const sent = []
  const { scripts, session } = setup(
    { dieleHistoryTarget: TARGET, dieleHistoryState: RECORDING },
    {
      chrome: {
        tabs: {
          sendMessage: async (tabId, message) => {
            sent.push([tabId, message.kind])
            if (tabId === 4) {
              throw new Error('Could not establish connection. Receiving end does not exist.')
            }

            return { ok: true }
          },
        },
      },
    },
  )

  await ready(scripts, 3)
  await ready(scripts, 4)
  await browse(scripts, 1)
  mock.timers.tick(5000)
  await flush()

  assert.deepEqual([...sent].sort(), [
    [3, 'history:flush'],
    [4, 'history:flush'],
  ])
  assert.deepEqual([...session.dieleHistoryTabs], [3])
  mock.timers.reset()
})

test('with no diele tab known, a visit sends nothing to any tab', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const { scripts, nudged, local } = setup({
    dieleHistoryTarget: TARGET,
    dieleHistoryState: RECORDING,
  })

  await browse(scripts, 3)
  mock.timers.tick(10_000)
  await flush()

  assert.equal(local.dieleHistoryBuffer.visits.length, 3)
  assert.deepEqual(nudged, [])
  mock.timers.reset()
})

test('a page that is not recorded nudges nobody', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const { scripts, nudged } = setup({ dieleHistoryTarget: TARGET, dieleHistoryState: RECORDING })

  await ready(scripts, 3)
  await scripts.recordHistoryVisit('https://www.google.com/search?q=private', undefined, Date.now())
  mock.timers.tick(10_000)
  await flush()

  assert.deepEqual(nudged, [])
  mock.timers.reset()
})

test('a closed tab is forgotten, and switching history off forgets them all', async () => {
  const { held, parts } = fakeBrowser({ permissions: ['webNavigation', 'scripting'] })
  const { scripts, session } = setup(
    { dieleHistoryTarget: TARGET, dieleHistoryState: RECORDING },
    { chrome: parts, target: true, session: { dieleHistoryTabs: [3, 4] } },
  )

  await scripts.forgetRelayTab(3)
  assert.deepEqual([...session.dieleHistoryTabs], [4])

  await scripts.deactivateHistory()
  assert.equal(session.dieleHistoryTabs, undefined)
  assert.equal(held.permissions.size, 0)
})
