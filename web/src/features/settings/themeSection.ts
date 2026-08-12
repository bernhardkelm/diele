import type { ThemePreference } from '@/composables/useTheme'
import type { SettingsSection } from '@/features/settings/settingsSections'

interface ThemeStep {
  readonly preference: ThemePreference
  /** What the row and the section's trail report while this one is in force */
  readonly word: string
  /** One line saying what the portal does in this state, not what pressing the row would do */
  readonly detail: string
}

// Order is the order the row steps through, and it wraps: the device's own choice first, because
// it is the one nothing was decided about yet.
const STEPS: ReadonlyArray<ThemeStep> = [
  {
    preference: 'system',
    word: 'device',
    detail: 'takes whichever theme the system is set to',
  },
  {
    preference: 'light',
    word: 'light',
    detail: 'pins the light palette, ignoring the device',
  },
  {
    preference: 'dark',
    word: 'dark',
    detail: 'pins the dark palette, ignoring the device',
  },
]

/**
 * Builds the section holding what the portal paints in: one row, which steps to the next theme
 * each time it is run and wraps around at the end. One row rather than one per theme, because
 * exactly one of them is ever in force and a set of switches where turning one on turns the
 * others off is three rows saying what one word says.
 * @param {ThemePreference} current - Theme the portal is on now
 * @param {(preference: ThemePreference) => void} set - Applies a theme and remembers it
 * @returns {SettingsSection} - The appearance section
 */
// @TODO: add a font preference here, the system mono or one of the faces we bundle
export function themeSection(
  current: ThemePreference,
  set: (preference: ThemePreference) => void,
): SettingsSection {
  // A stored value this build no longer knows reads as the first step rather than as no step at
  // all, which would leave the row with nothing to say and nowhere to go.
  const at = Math.max(
    0,
    STEPS.findIndex((step) => step.preference === current),
  )
  const step = STEPS[at]!
  const next = STEPS[(at + 1) % STEPS.length]!

  return {
    id: 'appearance',
    label: 'Appearance',
    description: 'the theme the portal paints in',
    keywords: ['theme', 'appearance', 'light', 'dark', 'mode', 'colour', 'color', 'system'],
    trail: step.word,
    options: [
      {
        id: 'theme',
        label: 'Theme',
        detail: step.detail,
        on: true,
        value: step.word,
        run: () => set(next.preference),
      },
    ],
  }
}
