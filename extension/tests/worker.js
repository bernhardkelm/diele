import { FILTER_FILES, loadScripts } from './load.js'

export const INSTANCE = 'https://diele.example.com/'
export const TARGET = { id: 'one', url: INSTANCE }
export const ACCOUNT = 'k3Xb9qL2vR8tY1wZ'
export const ON = {
  available: true,
  sources: { diele: false, extension: true },
  enabled: true,
  account: ACCOUNT,
}

/** What the worker stores for an account that accepts visits */
export const RECORDING = {
  instance: INSTANCE,
  signedIn: true,
  account: ACCOUNT,
  available: true,
  extension: true,
  enabled: true,
}

/**
 * Builds a chrome.storage area held in memory.
 * @param {object} data - What the area starts with, written to as the scripts write
 * @returns {object} - The area
 */
export function memoryArea(data) {
  return {
    async get(keys) {
      const names = Array.isArray(keys) ? keys : [keys]
      return Object.fromEntries(
        names.filter((name) => name in data).map((name) => [name, structuredClone(data[name])]),
      )
    },
    async set(items) {
      Object.assign(data, structuredClone(items))
    },
    async remove(keys) {
      for (const name of [keys].flat()) {
        delete data[name]
      }
    },
  }
}

/**
 * Loads the worker's storage side and the relay into one scope, with chrome faked in memory.
 * @param {object} local - What chrome.storage.local starts with
 * @param {{chrome?: object, target?: boolean, sync?: object, session?: object}} [extra] - Further
 *   chrome namespaces, whether to load the target handling, and what chrome.storage.sync and
 *   chrome.storage.session start with
 * @returns {{scripts: object, local: object, sync: object, session: object, nudged: number[]}} -
 *   The scope, the live storage areas and every tab a flush was sent to
 */
export function setup(local, extra = {}) {
  const sync = extra.sync ?? {
    dieleInstances: [{ id: 'one', name: '', url: INSTANCE }],
    dieleActiveId: 'one',
  }
  const session = extra.session ?? {}
  const nudged = []
  const chrome = {
    runtime: { id: 'ext', getURL: (path) => `chrome-extension://ext/${path}` },
    storage: { local: memoryArea(local), sync: memoryArea(sync), session: memoryArea(session) },
    tabs: {
      sendMessage: async (tabId) => {
        nudged.push(tabId)
        return { ok: true }
      },
    },
    ...extra.chrome,
  }
  const scripts = loadScripts(
    [
      'storage.js',
      'history/keys.js',
      ...FILTER_FILES,
      'history/scope.js',
      'history/buffer.js',
      'history/state.js',
      'history/store.js',
      'history/nudge.js',
      'history/messages.js',
      'history/relay.js',
      ...(extra.target ? ['history/capture.js', 'history/target.js'] : []),
    ],
    {
      chrome,
      crypto,
      structuredClone,
      // Looked up on every call, so a test's mocked timers apply; unref'd, so a nudge still
      // pending never holds the test run open
      setTimeout: (...args) => {
        const timer = setTimeout(...args)
        timer?.unref?.()
        return timer
      },
      clearTimeout: (timer) => clearTimeout(timer),
    },
  )

  return { scripts, local, sync, session, nudged }
}

/**
 * Builds the permissions and scripting namespaces of a browser that grants what it is asked for,
 * holding what was granted and registered.
 * @param {{permissions?: string[], origins?: string[], registered?: object[], failRegister?: boolean}} [start] -
 *   What the browser holds to begin with, and whether registering a content script throws
 * @returns {{held: {permissions: Set<string>, origins: Set<string>, registered: object[]}, parts: object}} -
 *   The live holdings and the namespaces
 */
export function fakeBrowser(start = {}) {
  const held = {
    permissions: new Set(start.permissions ?? []),
    origins: new Set(start.origins ?? []),
    registered: structuredClone(start.registered ?? []),
  }
  const covers = (asked) =>
    (asked.permissions ?? []).every((name) => held.permissions.has(name)) &&
    (asked.origins ?? []).every((origin) => held.origins.has(origin))

  const parts = {
    permissions: {
      contains: async (asked) => covers(asked),
      getAll: async () => ({ permissions: [...held.permissions], origins: [...held.origins] }),
      remove: async (gone) => {
        for (const name of gone.permissions ?? []) {
          held.permissions.delete(name)
        }

        for (const origin of gone.origins ?? []) {
          held.origins.delete(origin)
        }

        return true
      },
    },
    scripting: {
      getRegisteredContentScripts: async ({ ids }) =>
        structuredClone(held.registered.filter((script) => ids.includes(script.id))),
      registerContentScripts: async (scripts) => {
        if (start.failRegister) {
          throw new Error('registration refused')
        }

        held.registered.push(...structuredClone(scripts))
      },
      unregisterContentScripts: async ({ ids }) => {
        held.registered = held.registered.filter((script) => !ids.includes(script.id))
      },
    },
  }

  return { held, parts }
}
