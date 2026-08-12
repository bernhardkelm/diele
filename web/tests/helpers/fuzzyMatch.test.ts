import { describe, expect, it } from 'vitest'
import { fuzzyMatch, type FuzzyMatch } from '@/helpers/fuzzyMatch'

/**
 * Matches an ordinary, unquoted token, which is what all but the last block here is about.
 * @param {string} text - Haystack
 * @param {string} token - Lowercased token
 * @returns {FuzzyMatch | undefined} - The match, or undefined
 */
function match(text: string, token: string): FuzzyMatch | undefined {
  return fuzzyMatch(text, { text: token, exact: false })
}

/**
 * Matches a quoted token.
 * @param {string} text - Haystack
 * @param {string} token - Lowercased token
 * @returns {FuzzyMatch | undefined} - The match, or undefined
 */
function quoted(text: string, token: string): FuzzyMatch | undefined {
  return fuzzyMatch(text, { text: token, exact: true })
}

/**
 * Scores a token against a text, failing the test when it did not match at all.
 * @param {string} text - Haystack
 * @param {string} token - Lowercased token
 * @returns {number} - The score
 */
function score(text: string, token: string): number {
  const found = match(text, token)
  expect(found, `${token} did not match ${text}`).toBeDefined()

  return found!.score
}

describe('what does not match', () => {
  it('refuses an empty text or token', () => {
    expect(match('', 'a')).toBeUndefined()
    expect(match('Grafana', '')).toBeUndefined()
  })

  it('refuses a token whose characters are not all there', () => {
    expect(match('Grafana', 'xyz')).toBeUndefined()
    expect(match('Grafana', 'grafanas')).toBeUndefined()
  })

  // Letting a one or two character token scatter would match nearly everything, which is
  // worse than not matching at all.
  it('refuses a short token that would only match by scattering', () => {
    expect(match('Grafana', 'ga')).toBeUndefined()
    expect(match('Prometheus', 'ph')).toBeUndefined()
  })
})

describe('how matches rank', () => {
  // Tier floors are spaced wider than the quality bonus, so no tier can be lifted past the next.
  it('ranks exact over prefix over word start over substring', () => {
    const exact = score('kuma', 'kuma')
    const prefix = score('kuma dashboard', 'kuma')
    const wordStart = score('uptime kuma', 'kuma')
    const substring = score('akumal', 'kuma')

    expect(exact).toBeGreaterThan(prefix)
    expect(prefix).toBeGreaterThan(wordStart)
    expect(wordStart).toBeGreaterThan(substring)
  })

  it('ranks any literal hit above a scattered one', () => {
    expect(score('prometheus', 'prom')).toBeGreaterThan(score('prometheus', 'pmts'))
  })

  // A hump opens a word the way a separator does, so a camel-cased name is searchable by
  // its parts.
  it('treats a camel hump as a word start', () => {
    expect(score('UptimeKuma', 'kuma')).toBeGreaterThan(score('akumal', 'kuma'))
  })

  it('prefers the shorter of two names that both match the same way', () => {
    expect(score('kuma', 'kum')).toBeGreaterThan(score('kuma dashboard mirror', 'kum'))
  })
})

describe('acronyms and subsequences', () => {
  // Landing every character on a word start is specific enough to stay useful two characters
  // down, which is what makes `uk` find `Uptime Kuma`.
  it('finds a name by the initials of its words', () => {
    const found = match('Uptime Kuma', 'uk')

    expect(found).toBeDefined()
    expect(found!.ranges).toEqual([
      { start: 0, end: 1 },
      { start: 7, end: 8 },
    ])
  })

  it('tolerates a typo without matching everything', () => {
    expect(match('prometheus', 'prometeus')).toBeDefined()
    expect(match('prometheus', 'abc')).toBeUndefined()
  })
})

describe('the ranges a renderer marks up', () => {
  it('reports one contiguous range for a literal hit', () => {
    expect(match('uptime kuma', 'kuma')!.ranges).toEqual([{ start: 7, end: 11 }])
  })

  it('reports ranges ascending and non-overlapping', () => {
    const { ranges } = match('example-group/web', 'egw')!

    for (const [index, range] of ranges.entries()) {
      expect(range.end).toBeGreaterThan(range.start)

      const previous = ranges[index - 1]
      if (previous) {
        expect(range.start).toBeGreaterThanOrEqual(previous.end)
      }
    }
  })

  // A forward pass alone misses this whenever an early character of the token repeats.
  it('picks the tightest window when a character repeats', () => {
    const { ranges } = match('aabac', 'abc')!

    expect(ranges.at(-1)!.end).toBe(5)
    expect(ranges[0]!.start).toBeGreaterThan(0)
  })

  it('matches case-insensitively but reports positions in the original text', () => {
    expect(match('GRAFANA', 'graf')!.ranges).toEqual([{ start: 0, end: 4 }])
  })
})

// Asking for a quoted term is asking for the guessing to stop.
describe('a quoted token', () => {
  it('still matches wherever it literally appears', () => {
    expect(quoted('Grafana', 'grafana')).toBeDefined()
    expect(quoted('uptime kuma', 'kuma')!.ranges).toEqual([{ start: 7, end: 11 }])
    expect(quoted('GRAFANA', 'graf')!.ranges).toEqual([{ start: 0, end: 4 }])
  })

  it('scores a literal hit exactly as an unquoted one does', () => {
    expect(quoted('uptime kuma', 'kuma')!.score).toBe(match('uptime kuma', 'kuma')!.score)
  })

  it('refuses the initials an unquoted token would have matched', () => {
    expect(match('Uptime Kuma', 'uk')).toBeDefined()
    expect(quoted('Uptime Kuma', 'uk')).toBeUndefined()
  })

  it('refuses the typo an unquoted token would have tolerated', () => {
    expect(match('prometheus', 'prometeus')).toBeDefined()
    expect(quoted('prometheus', 'prometeus')).toBeUndefined()
  })

  // The phrase is one token however many separators are inside it, so it has to be findable
  // across them rather than only inside a single word.
  it('matches a phrase carrying its own separators', () => {
    expect(quoted('example-group/web', 'group/web')).toBeDefined()
    expect(quoted('Uptime Kuma', 'uptime kuma')).toBeDefined()
    expect(quoted('example-group/web-ui', 'group/web ui')).toBeUndefined()
  })
})

it('keeps every score inside the documented range', () => {
  for (const [text, token] of [
    ['kuma', 'kuma'],
    ['uptime kuma', 'kuma'],
    ['prometheus', 'pmts'],
    ['Uptime Kuma', 'uk'],
  ] as const) {
    const value = score(text, token)

    expect(value).toBeGreaterThan(0)
    expect(value).toBeLessThan(1000)
  }
})
