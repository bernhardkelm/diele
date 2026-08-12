import { describe, expect, it, vi } from 'vitest'
import type { ThemePreference } from '@/composables/useTheme'
import { themeSection } from '@/features/settings/themeSection'

/**
 * Builds the section and hands back its single row alongside the setter it was built with.
 * @param {ThemePreference} current - Theme the portal is on
 * @returns {object} - The row, the section and the setter
 */
function open(current: ThemePreference) {
  const set = vi.fn()
  const section = themeSection(current, set)

  return { section, row: section.options[0]!, set }
}

describe('the appearance section', () => {
  it('holds one row rather than one per theme', () => {
    expect(themeSection('system', vi.fn()).options).toHaveLength(1)
  })

  it('reports the theme in force on the row and on the section', () => {
    for (const [preference, word] of [
      ['system', 'device'],
      ['light', 'light'],
      ['dark', 'dark'],
    ] as ReadonlyArray<[ThemePreference, string]>) {
      const { section, row } = open(preference)

      expect(section.trail).toBe(word)
      expect(row.value).toBe(word)
    }
  })

  // The row is a setting that is in force whichever theme it names, so nothing about it is
  // dormant and it must not be drawn the way an unset switch is.
  it('is never off', () => {
    for (const preference of ['system', 'light', 'dark'] as ReadonlyArray<ThemePreference>) {
      expect(open(preference).row.on).toBe(true)
    }
  })

  it('says what the portal does now, not what pressing it would do', () => {
    expect(open('light').row.detail).toContain('light palette')
    expect(open('system').row.detail).toContain('system')
  })

  it('steps to the next theme and wraps around at the end', () => {
    for (const [current, next] of [
      ['system', 'light'],
      ['light', 'dark'],
      ['dark', 'system'],
    ] as ReadonlyArray<[ThemePreference, ThemePreference]>) {
      const { row, set } = open(current)

      row.run()

      expect(set).toHaveBeenCalledWith(next)
    }
  })

  // A value stored by a build that knew a theme this one does not would otherwise leave the row
  // with nothing to say and nowhere to step to.
  it('falls back to the first step for a theme it does not know', () => {
    const { section, row, set } = open('sepia' as ThemePreference)

    expect(section.trail).toBe('device')
    row.run()

    expect(set).toHaveBeenCalledWith('light')
  })
})
