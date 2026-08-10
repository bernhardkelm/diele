import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyBrandAccent } from '@/helpers/brandAccent'
import { isLocalhostUrl } from '@/helpers/localhost'
import { pushRecent } from '@/helpers/recentList'
import { formatRelativeTime } from '@/helpers/relativeTime'
import { FIELD_HINTS, LEAVE_HINT } from '@/helpers/keyHints'

describe('applyBrandAccent', () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty('--diele-accent')
  })

  it('writes both themes as one light-dark pair', () => {
    applyBrandAccent({ title: 'd', subtitle: 's', accentLight: '#16a34a', accentDark: '#22c55e' })

    expect(document.documentElement.style.getPropertyValue('--diele-accent')).toBe(
      'light-dark(#16a34a, #22c55e)',
    )
  })

  // This value can arrive from the localStorage cache, which is not a trusted source, and it
  // lands in a css custom property where anything but a colour would escape into the rule.
  it('refuses anything that is not a six-digit hex', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['red', '#22c55e'],
      ['#16a34a', 'blue'],
      ['#abc', '#22c55e'],
      ['#16a34a; background: url(evil)', '#22c55e'],
      ['', ''],
    ]

    for (const [light, dark] of cases) {
      applyBrandAccent({ title: 'd', subtitle: 's', accentLight: light, accentDark: dark })

      expect(document.documentElement.style.getPropertyValue('--diele-accent')).toBe('')
    }
  })
})

describe('isLocalhostUrl', () => {
  it('recognises the loopback names', () => {
    for (const url of ['http://localhost:5173', 'https://127.0.0.1/x', 'http://[::1]:3000']) {
      expect(isLocalhostUrl(url), url).toBe(true)
    }
  })

  it('rejects anything else, including a host that merely mentions one', () => {
    for (const url of [
      'https://example.com',
      'https://localhost.evil.com',
      'https://notlocalhost',
      'not a url',
      '',
    ]) {
      expect(isLocalhostUrl(url), url).toBe(false)
    }
  })
})

describe('pushRecent', () => {
  it('puts the value at the front', () => {
    expect(pushRecent(['b', 'c'], 'a', 5)).toEqual(['a', 'b', 'c'])
  })

  it('moves an existing value rather than duplicating it', () => {
    expect(pushRecent(['a', 'b', 'c'], 'c', 5)).toEqual(['c', 'a', 'b'])
  })

  it('drops the oldest past the cap', () => {
    expect(pushRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b'])
  })

  it('leaves the list it was given alone', () => {
    const current = ['a', 'b']
    pushRecent(current, 'c', 5)

    expect(current).toEqual(['a', 'b'])
  })

  it('copes with an empty list and a cap of one', () => {
    expect(pushRecent([], 'a', 5)).toEqual(['a'])
    expect(pushRecent(['a', 'b'], 'c', 1)).toEqual(['c'])
  })
})

describe('formatRelativeTime', () => {
  const now = new Date('2026-08-08T12:00:00Z')

  afterEach(() => {
    vi.useRealTimers()
  })

  it('picks the coarsest unit that still yields a whole one', () => {
    expect(formatRelativeTime('2026-08-05T12:00:00Z', now)).toBe('3d ago')
    expect(formatRelativeTime('2026-08-08T09:00:00Z', now)).toBe('3h ago')
    expect(formatRelativeTime('2026-08-08T11:57:00Z', now)).toBe('3m ago')
    expect(formatRelativeTime('2025-08-08T12:00:00Z', now)).toBe('1y ago')
  })

  it('reads anything under a minute as just now', () => {
    expect(formatRelativeTime('2026-08-08T11:59:30Z', now)).toBe('just now')
    expect(formatRelativeTime('2026-08-08T12:00:00Z', now)).toBe('just now')
  })

  it('handles a timestamp in the future', () => {
    expect(formatRelativeTime('2026-08-11T12:00:00Z', now)).toBe('in 3d')
  })

  it('reads an unparseable timestamp as nothing rather than throwing', () => {
    expect(formatRelativeTime('not a date', now)).toBeUndefined()
    expect(formatRelativeTime('', now)).toBeUndefined()
  })

  it('measures against the current instant when given none', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)

    expect(formatRelativeTime('2026-08-05T12:00:00Z')).toBe('3d ago')
  })
})

// A phone has no keyboard for these, so the launcher bar drops the ones marked as keys.
describe('key hints', () => {
  it('marks the hints that need a keyboard', () => {
    expect(FIELD_HINTS.filter((hint) => hint.key)).toHaveLength(2)
    expect(FIELD_HINTS.filter((hint) => !hint.key)).toEqual([LEAVE_HINT])
  })
})
