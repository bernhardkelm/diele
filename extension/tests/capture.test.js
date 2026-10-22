import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import { loadScripts } from './load.js'

const URL_LOADED = 'https://app.example.com/oauth/callback?code=abc&state=xyz'

/**
 * Loads the capture with tabs, storage and the recorder faked, and timers under the test's control.
 * @param {{incognito?: boolean, url?: string, title?: string}} [tab] - What tabs.get answers
 * @param {{titles?: boolean, incognitoAllowed?: boolean}} [options] - Whether the titles switch
 *   is on, and whether the extension is allowed in incognito
 * @returns {{scripts: object, recorded: Array<unknown[]>, lookups: number[]}} - The scope, what
 *   reached the recorder and which tabs were looked up
 */
function setup(tab = {}, options = { titles: true }) {
  const recorded = []
  const lookups = []
  const chrome = {
    extension: { isAllowedIncognitoAccess: async () => options.incognitoAllowed === true },
    storage: {
      local: {
        get: async () => ({
          dieleHistoryTarget: {
            id: 'one',
            url: 'https://diele.example.com/',
            titles: options.titles,
          },
        }),
      },
    },
    tabs: {
      get: async (id) => {
        lookups.push(id)
        return { id, incognito: false, url: URL_LOADED, title: 'Signed in', ...tab }
      },
    },
  }
  const scripts = loadScripts(['history/keys.js', 'history/capture.js'], {
    chrome,
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (id) => clearTimeout(id),
    recordHistoryVisit: async (...args) => {
      recorded.push(args)
    },
  })

  return { scripts, recorded, lookups }
}

/**
 * Builds a navigation event's details.
 * @param {object} [overrides] - Fields that differ from a top-level load in tab 3
 * @returns {object} - The details
 */
function details(overrides = {}) {
  return { tabId: 3, frameId: 0, url: URL_LOADED, timeStamp: 1000, ...overrides }
}

/**
 * Lets the settling time pass and the recorder's promise chain run.
 * @returns {Promise<void>}
 */
async function settle() {
  mock.timers.tick(2000)

  for (let turn = 0; turn < 5; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

test('with titles off no tab is looked up and no title recorded', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const { scripts, recorded, lookups } = setup({}, { titles: false })

  scripts.onNavigationCompleted(details())
  await settle()

  assert.deepEqual(recorded, [[URL_LOADED, undefined, 1000]])
  assert.deepEqual(lookups, [])
  mock.timers.reset()
})

// The tab is the only way to tell an incognito one, but its title is still not read
test('allowed in incognito with titles off, the tab is checked and its title left alone', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const normal = setup({}, { titles: false, incognitoAllowed: true })

  normal.scripts.onNavigationCompleted(details())
  await settle()
  assert.deepEqual(normal.recorded, [[URL_LOADED, undefined, 1000]])
  assert.deepEqual(normal.lookups, [3])

  const incognito = setup({ incognito: true }, { titles: false, incognitoAllowed: true })
  incognito.scripts.onNavigationCompleted(details())
  await settle()
  assert.equal(incognito.recorded.length, 0)
  mock.timers.reset()
})

test('a completed top-level load is recorded once it settles, with its title', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const { scripts, recorded } = setup()

  scripts.onNavigationCompleted(details())
  assert.equal(recorded.length, 0)
  await settle()

  assert.deepEqual(recorded, [[URL_LOADED, 'Signed in', 1000]])
  mock.timers.reset()
})

test('an error after the completion, or before it, means no visit', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const { scripts, recorded } = setup()

  scripts.onNavigationCompleted(details())
  scripts.onNavigationError(details({ timeStamp: 1100 }))
  await settle()

  scripts.onNavigationError(details({ timeStamp: 5000 }))
  scripts.onNavigationCompleted(details({ timeStamp: 5200 }))
  await settle()

  assert.equal(recorded.length, 0)
  mock.timers.reset()
})

test('frames, prerendered pages and incognito tabs are never recorded', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const { scripts, recorded } = setup()

  scripts.onNavigationCompleted(details({ frameId: 4 }))
  scripts.onNavigationCompleted(details({ tabId: 5, documentLifecycle: 'prerender' }))
  await settle()
  assert.equal(recorded.length, 0)

  const incognito = setup({ incognito: true }, { titles: true, incognitoAllowed: true })
  incognito.scripts.onNavigationCompleted(details())
  await settle()
  assert.equal(incognito.recorded.length, 0)
  mock.timers.reset()
})

test('a tab that moved on gives no title, and switching off drops what is settling', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const moved = setup({ url: 'https://next.example/', title: 'Next page' })

  moved.scripts.onNavigationCompleted(details())
  await settle()
  assert.deepEqual(moved.recorded, [[URL_LOADED, undefined, 1000]])

  const { scripts, recorded } = setup()
  scripts.onNavigationCompleted(details())
  scripts.forgetPendingNavigations()
  await settle()
  assert.equal(recorded.length, 0)
  mock.timers.reset()
})
