import { ref, type Ref } from 'vue'
import { readStored, removeStored, writeStored } from '@/helpers/storage'

/** localStorage key holding the theme override, absent while the device decides. */
const STORAGE_KEY = 'diele:theme'

/** What the portal paints in: the device's own choice, or one the override pins it to. */
export type ThemePreference = 'system' | 'light' | 'dark'

const PREFERENCES: ReadonlyArray<ThemePreference> = ['system', 'light', 'dark']

export interface Theme {
  preference: Ref<ThemePreference>
  /** Pins the portal to a theme, or hands it back to the device with `system` */
  set: (preference: ThemePreference) => void
}

/**
 * Returns whether a stored value still names a theme this build knows.
 * @param {unknown} value - Raw value read back from storage
 * @returns {boolean} - True for a known preference
 */
function isPreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && PREFERENCES.includes(value as ThemePreference)
}

/**
 * Reads the override an earlier visit left behind.
 * @returns {ThemePreference} - Stored preference, `system` when absent or unreadable
 */
function read(): ThemePreference {
  const raw = readStored(STORAGE_KEY)

  return isPreference(raw) ? raw : 'system'
}

/**
 * Writes the override onto the document, where the token layer picks it up. `system` clears
 * the attribute rather than naming a theme, which is what hands the choice back to the OS.
 * @param {ThemePreference} preference - Theme to apply
 * @returns {void}
 */
function apply(preference: ThemePreference): void {
  const root = document.documentElement

  if (preference === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', preference)
  }
}

/**
 * Applies the stored override at import time, before the app mounts, so a pinned theme is
 * already on the document for the first paint rather than flashing the device's one.
 * @returns {void}
 */
export function initTheme(): void {
  apply(read())
}

// Shared at module scope: the document has one theme, so a second caller has to read the same
// value rather than a copy taken when it happened to ask.
const preference = ref<ThemePreference>(read())

/**
 * Holds which theme the portal paints in. The device's own light or dark preference is the
 * default; an override pins it to one and outlives the visit, since a choice made once is
 * meant to hold.
 * @returns {Theme} - Reactive preference and its setter
 */
export function useTheme(): Theme {
  /**
   * Pins the portal to a theme and remembers it for the next visit.
   * @param {ThemePreference} next - Theme to apply
   * @returns {void}
   */
  function set(next: ThemePreference): void {
    preference.value = next
    apply(next)

    // `system` clears the key rather than storing a name, so a later default change is picked
    // up instead of being pinned to whatever it was on the day the choice was made
    if (next === 'system') {
      removeStored(STORAGE_KEY)
    } else {
      writeStored(STORAGE_KEY, next)
    }
  }

  return { preference, set }
}
