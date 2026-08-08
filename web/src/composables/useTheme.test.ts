import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initTheme, useTheme } from '@/composables/useTheme'

const KEY = 'diele:theme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  // The module holds one shared preference, so a test that pinned it hands it back here.
  useTheme().set('system')
  localStorage.clear()
})

afterEach(() => {
  document.documentElement.removeAttribute('data-theme')
})

describe('pinning a theme', () => {
  it('writes the override onto the document and remembers it', () => {
    const { preference, set } = useTheme()

    set('dark')

    expect(preference.value).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem(KEY)).toBe('dark')
  })

  // `system` clears the key rather than storing a name, so a later default change is picked up
  // instead of being pinned to whatever it was on the day the choice was made.
  it('hands the choice back to the device on system', () => {
    const { preference, set } = useTheme()

    set('light')
    set('system')

    expect(preference.value).toBe('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})

// The document has one theme, so a second caller reads the same value rather than a copy.
it('shares one preference between callers', () => {
  const first = useTheme()
  const second = useTheme()

  first.set('dark')

  expect(second.preference.value).toBe('dark')
})

describe('initTheme', () => {
  // Applied before the app mounts, so a pinned theme is on the document for the first paint
  // rather than flashing the device's one.
  it('applies a stored override', () => {
    localStorage.setItem(KEY, 'light')

    initTheme()

    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('leaves the document alone when nothing was stored', () => {
    initTheme()

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('ignores a stored value this build no longer knows', () => {
    for (const stored of ['sepia', '', 'DARK', '{"a":1}']) {
      localStorage.setItem(KEY, stored)
      document.documentElement.setAttribute('data-theme', 'dark')

      initTheme()

      expect(document.documentElement.hasAttribute('data-theme'), stored).toBe(false)
    }
  })
})
