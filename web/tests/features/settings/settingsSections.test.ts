import { describe, expect, it, vi } from 'vitest'
import { searchSections, type SettingsSection } from '@/features/settings/settingsSections'
import { buildSettingsStations, sectionKey } from '@/features/settings/settingsStations'
import { settingsActions } from '@/features/settings/settingsActions'
import { settingsHintsFor } from '@/features/settings/settingsHints'
import type { ListAction } from '@/helpers/listActions'

/**
 * Builds a section to search or place in the ring.
 * @param {Partial<SettingsSection>} overrides - Fields to set on top of a minimal section
 * @returns {SettingsSection} - The section
 */
function section(overrides: Partial<SettingsSection> = {}): SettingsSection {
  return {
    id: 'appearance',
    label: 'Appearance',
    description: 'the theme the portal paints in',
    keywords: ['theme', 'dark'],
    trail: 'device',
    options: [],
    ...overrides,
  }
}

const hidden = section({
  id: 'hidden',
  label: 'Hidden entries',
  description: 'pick the repos to keep out of your own list',
  keywords: ['repo', 'hide'],
  trail: '2/3',
  options: [
    { id: 'a', label: 'example-group/web', detail: 'shown in the list', on: true, run: vi.fn() },
    {
      id: 'b',
      label: 'example-group/api',
      detail: 'kept out of the list',
      on: false,
      run: vi.fn(),
    },
  ],
})

const sections = [section(), hidden]

describe('searchSections', () => {
  it('hands everything back in source order for a blank term', () => {
    expect(searchSections(sections, '', undefined)).toBe(sections)
  })

  it('finds a section by its label, id, keywords or prose', () => {
    expect(searchSections(sections, 'appearance', undefined).map((s) => s.id)).toEqual([
      'appearance',
    ])
    expect(searchSections(sections, 'dark', undefined).map((s) => s.id)).toEqual(['appearance'])
    expect(searchSections(sections, 'repos', undefined).map((s) => s.id)).toEqual(['hidden'])
  })

  it('offers nothing for a term that addresses none of them', () => {
    expect(searchSections(sections, 'zzznothing', undefined)).toEqual([])
  })

  // A repo name typed with the repos open finds that repo, which is the whole point of a
  // section long enough to need searching.
  it('narrows what is inside the open section rather than dropping it', () => {
    const [first] = searchSections(sections, 'api', 'hidden')

    expect(first!.id).toBe('hidden')
    expect(first!.options.map((option) => option.id)).toEqual(['b'])
  })

  it('keeps the open section leading even when the term misses it entirely', () => {
    const found = searchSections(sections, 'zzznothing', 'hidden')

    expect(found.map((s) => s.id)).toEqual(['hidden'])
    expect(found[0]!.options).toEqual([])
  })

  it('leaves a closed section rows alone', () => {
    const [found] = searchSections(sections, 'hidden', undefined)

    expect(found!.options).toHaveLength(2)
  })
})

describe('buildSettingsStations', () => {
  const actions = settingsActions({
    leave: vi.fn(),
    signOut: vi.fn(),
    signOutEverywhere: vi.fn(),
    name: 'Ada',
  })

  it('places one station per section, then the closing actions', () => {
    const stations = buildSettingsStations(sections, undefined, actions)

    expect(stations.map((s) => s.kind)).toEqual([
      'section',
      'section',
      'action',
      'action',
      'action',
    ])
    expect(stations[0]!.key).toBe(sectionKey('appearance'))
  })

  // Walking down from a section steps into its options rather than over them.
  it('puts the open section rows directly under it', () => {
    const stations = buildSettingsStations(sections, 'hidden', [])

    expect(stations.map((s) => s.kind)).toEqual(['section', 'section', 'option', 'option'])
  })

  // Ahead of the options the way `Add entry` is in the admin panel.
  it('puts a section own action ahead of its options', () => {
    const restore: ListAction = {
      kind: 'action',
      id: 'show-all',
      label: 'Show all hidden entries',
      description: 'brings them back',
      run: vi.fn(),
    }
    const stations = buildSettingsStations([{ ...hidden, action: restore }], 'hidden', [])

    expect(stations.map((s) => s.kind)).toEqual(['section', 'action', 'option', 'option'])
    expect(stations[1]).toMatchObject({ nested: true })
  })

  it('marks the closing actions as belonging to the list rather than a section', () => {
    const stations = buildSettingsStations(sections, undefined, actions)

    for (const station of stations.filter((s) => s.kind === 'action')) {
      expect(station.nested).toBe(false)
    }
  })

  it('gives every station a key of its own', () => {
    const keys = buildSettingsStations(sections, 'hidden', actions).map((s) => s.key)

    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('settingsActions', () => {
  // Signing out is the one row with a consequence beyond this browser, so it belongs where
  // nothing is stepped through it by accident.
  it('puts leaving first and signing out last', () => {
    const actions = settingsActions({
      leave: vi.fn(),
      signOut: vi.fn(),
      signOutEverywhere: vi.fn(),
      name: 'Ada',
    })

    expect(actions.map((action) => action.id)).toEqual(['leave', 'signout', 'signout-all'])
  })

  it('names who is being signed out when it knows', () => {
    expect(
      settingsActions({
        leave: vi.fn(),
        signOut: vi.fn(),
        signOutEverywhere: vi.fn(),
        name: 'Ada',
      })[1]!.description,
    ).toBe('ends the session for Ada')
    expect(
      settingsActions({
        leave: vi.fn(),
        signOut: vi.fn(),
        signOutEverywhere: vi.fn(),
        name: null,
      })[1]!.description,
    ).toBe('ends the session')
  })

  it('runs what it was given', () => {
    const leave = vi.fn()
    const signOut = vi.fn()
    const signOutEverywhere = vi.fn()
    const actions = settingsActions({ leave, signOut, signOutEverywhere, name: null })

    actions[0]!.run()
    actions[1]!.run()
    actions[2]!.run()

    expect(leave).toHaveBeenCalled()
    expect(signOut).toHaveBeenCalled()
    expect(signOutEverywhere).toHaveBeenCalled()
  })

  // The row that reaches beyond this browser says so, because the one above it reads almost the
  // same and ends only the session in front of you.
  it('says the everywhere row reaches the other devices', () => {
    const actions = settingsActions({
      leave: vi.fn(),
      signOut: vi.fn(),
      signOutEverywhere: vi.fn(),
      name: 'Ada',
    })

    expect(actions[2]!.description).toBe('ends every session, on this device and any other')
  })
})

describe('settingsHintsFor', () => {
  it('names the field keys while nothing in the list holds focus', () => {
    expect(settingsHintsFor(undefined, false).map((hint) => hint.text)).toEqual([
      '↑↓ selects',
      '↵ opens',
      'esc leaves',
    ])
  })

  it('says whether Enter opens or closes a section', () => {
    const station = { kind: 'section', key: 'k', label: 'l', section: hidden } as const

    expect(settingsHintsFor(station, false).map((h) => h.text)).toContain('↵ opens')
    expect(settingsHintsFor(station, true).map((h) => h.text)).toContain('↵ closes')
  })

  it('names the switch keys on an option and the run key on an action', () => {
    const option = {
      kind: 'option',
      key: 'k',
      label: 'l',
      section: hidden,
      option: hidden.options[0]!,
    } as const
    const action = {
      kind: 'action',
      key: 'k',
      label: 'l',
      action: settingsActions({
        leave: vi.fn(),
        signOut: vi.fn(),
        signOutEverywhere: vi.fn(),
        name: null,
      })[0]!,
      nested: false,
    } as const

    expect(settingsHintsFor(option, false).map((h) => h.text)).toEqual([
      '↵ turns it on/off',
      'd on/off',
      'esc leaves',
    ])
    expect(settingsHintsFor(action, false).map((h) => h.text)).toEqual(['↵ runs', 'esc leaves'])
  })

  // A row naming more than two states steps rather than flips, and saying it turns something on
  // would name the one thing pressing it does not do.
  it('names the stepping keys on a row that carries a value', () => {
    const station = {
      kind: 'option',
      key: 'k',
      label: 'Theme',
      section: hidden,
      option: {
        id: 'theme',
        label: 'Theme',
        detail: 'pins the dark palette',
        on: true,
        value: 'dark',
        run: vi.fn(),
      },
    } as const

    expect(settingsHintsFor(station, false).map((h) => h.text)).toEqual([
      '↵ steps to the next',
      'd steps',
      'esc leaves',
    ])
  })
})
