import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const ROOT = new URL('..', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', ROOT), 'utf8'))
const worker = readFileSync(new URL('background.js', ROOT), 'utf8')

/**
 * Reads the files background.js hands to importScripts, in order.
 * @returns {string[]} - The paths
 */
function importedFiles() {
  const call = /importScripts\(([\s\S]*?)\)/.exec(worker)[1]
  return [...call.matchAll(/'([^']+)'/g)].map((match) => match[1])
}

test('the manifest asks for storage alone, and for everything else only as optional', () => {
  assert.equal(manifest.manifest_version, 3)
  assert.deepEqual(manifest.permissions, ['storage'])
  assert.deepEqual(manifest.optional_permissions.sort(), ['scripting', 'tabs', 'webNavigation'])
  assert.equal(manifest.host_permissions, undefined)
  assert.equal(manifest.content_scripts, undefined)
})

// Firefox's match patterns cannot carry a port, and refuse one that does
test('no host pattern names a port', () => {
  for (const pattern of manifest.optional_host_permissions) {
    assert.doesNotMatch(pattern, /:\/\/[^/]*:\d/, pattern)
  }
})

test('Chrome gets its service worker and Firefox its background scripts, the same files', () => {
  assert.equal(manifest.background.service_worker, 'background.js')
  assert.deepEqual(manifest.background.scripts, [...importedFiles(), 'background.js'])

  for (const file of manifest.background.scripts) {
    assert.equal(existsSync(new URL(file, ROOT)), true, file)
  }
})

// 128 is the first release with optional_host_permissions, and past the 121 that starts the
// background page when service_worker is present too
test('Firefox gets an id and a floor it can run on', () => {
  const gecko = manifest.browser_specific_settings.gecko

  assert.match(gecko.id, /^[\w.-]+@[\w.-]+$/)
  assert.ok(Number.parseFloat(gecko.strict_min_version) >= 128)
})

/**
 * Builds a fake of the chrome namespace the worker touches at load, recording what it listens to.
 * @param {string[]} heard - Receives the name of every event a listener is added to
 * @returns {object} - The fake
 */
function fakeChrome(heard) {
  const event = (name) => ({
    addListener: () => heard.push(name),
    hasListener: () => false,
  })

  return {
    runtime: {
      id: 'x',
      getURL: (path) => `moz-extension://x/${path}`,
      onMessage: event('message'),
      onInstalled: event('installed'),
      onStartup: event('startup'),
    },
    permissions: { onAdded: event('added'), onRemoved: event('removed') },
    tabs: { onRemoved: event('tabRemoved') },
    storage: { onChanged: event('changed') },
    webNavigation: { onCompleted: event('completed'), onErrorOccurred: event('error') },
  }
}

const EVENTS = [
  'completed',
  'error',
  'message',
  'added',
  'removed',
  'installed',
  'tabRemoved',
  'startup',
  'changed',
]

test('the worker loads through importScripts, the way Chrome runs it', () => {
  const heard = []
  const context = vm.createContext({ URL, chrome: fakeChrome(heard) })

  context.importScripts = (...files) => {
    for (const file of files) {
      vm.runInContext(readFileSync(new URL(file, ROOT), 'utf8'), context, { filename: file })
    }
  }
  vm.runInContext(worker, context, { filename: 'background.js' })

  assert.deepEqual(heard.sort(), [...EVENTS].sort())
})

test('the worker loads as the manifest lists it, without importScripts, the way Firefox runs it', () => {
  const heard = []
  const context = vm.createContext({ URL, chrome: fakeChrome(heard) })

  for (const file of manifest.background.scripts) {
    vm.runInContext(readFileSync(new URL(file, ROOT), 'utf8'), context, { filename: file })
  }

  assert.equal(typeof context.importScripts, 'undefined')
  assert.deepEqual(heard.sort(), [...EVENTS].sort())
})
