import { afterEach } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'

// Node defines a `localStorage` global that stays undefined without `--localstorage-file`,
// and it shadows the one jsdom would otherwise install. Browsers have the real thing, so
// the gap is the test environment's alone.
if (typeof localStorage === 'undefined') {
  const entries = new Map<string, string>()

  const memoryStorage: Storage = {
    get length() {
      return entries.size
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, String(value)),
    removeItem: (key: string) => void entries.delete(key),
    clear: () => entries.clear(),
  }

  Object.defineProperty(globalThis, 'localStorage', {
    value: memoryStorage,
    configurable: true,
    writable: true,
  })
}

// jsdom lays nothing out, so it ships no scrollIntoView at all. A no-op stands in for it,
// which also lets a test assert that the highlight asked to be revealed.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {}
}

// Unmounts anything a test mounted, whether or not it got that far itself. Several composables
// here listen on the window, so one left behind keeps answering keys in every later test.
enableAutoUnmount(afterEach)
