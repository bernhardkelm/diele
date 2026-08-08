import type { ThemePreference } from '@/composables/useTheme'
import type { SettingsSection } from '@/features/settings/settingsSections'

interface ThemeOption {
  readonly preference: ThemePreference
  readonly label: string
  readonly detail: string
  /** What the section's trail reports while this one is in force */
  readonly trail: string
}

const OPTIONS: ReadonlyArray<ThemeOption> = [
  {
    preference: 'system',
    label: 'Follow the device',
    detail: 'takes whichever theme the system is set to',
    trail: 'device',
  },
  {
    preference: 'light',
    label: 'Always light',
    detail: 'pins the light palette, ignoring the device',
    trail: 'light',
  },
  {
    preference: 'dark',
    label: 'Always dark',
    detail: 'pins the dark palette, ignoring the device',
    trail: 'dark',
  },
]

/**
 * Builds the section holding what the portal paints in: one row per theme, of which exactly
 * one is on. Turning one on is what turns the others off, so there is nothing to turn off by
 * hand and no state where the portal has no theme at all.
 * @param {ThemePreference} current - Theme the portal is on now
 * @param {(preference: ThemePreference) => void} set - Applies a theme and remembers it
 * @returns {SettingsSection} - The appearance section
 */
// @TODO: add a font preference here, the system mono or one of the faces we bundle
export function themeSection(
  current: ThemePreference,
  set: (preference: ThemePreference) => void,
): SettingsSection {
  const active = OPTIONS.find((option) => option.preference === current)

  return {
    id: 'appearance',
    label: 'Appearance',
    description: 'the theme the portal paints in',
    keywords: ['theme', 'appearance', 'light', 'dark', 'mode', 'colour', 'color', 'system'],
    trail: active?.trail ?? 'device',
    options: OPTIONS.map((option) => ({
      id: option.preference,
      label: option.label,
      detail: option.detail,
      on: option.preference === current,
      run: () => set(option.preference),
    })),
  }
}
