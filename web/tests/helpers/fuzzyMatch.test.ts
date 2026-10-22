import { describe, expect, it } from 'vitest'
import { fuzzyMatch, type FuzzyMatch } from '@/helpers/fuzzyMatch'
import { MATCH_TIERS } from '@/helpers/matchTiers'

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

  it('refuses a token no word of the text comes close to', () => {
    expect(match('Grafana', 'xyz')).toBeUndefined()
    expect(match('Grafana', 'grafanasxyz')).toBeUndefined()
  })

  // Letters that merely appear in order somewhere are no match: this is what listed ten repos
  // above the page `heise` meant.
  it('refuses a token whose letters are only scattered across the text', () => {
    expect(match('Klickmeister/freiheit-und-gleichheit-in-der-bildungsgeschichte', 'heise')).toBe(
      undefined,
    )
    expect(match('bernhardkelm/undisclosed', 'heise')).toBeUndefined()
    expect(match('bernhardkelm/miwo_datasets', 'heise')).toBeUndefined()
    expect(match('prometheus', 'pmts')).toBeUndefined()
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

  it('ranks any literal hit above an acronym, and an acronym above a typo', () => {
    expect(score('akumal', 'kuma')).toBeGreaterThan(
      score('Kubernetes Uptime Monitor Agent', 'kuma'),
    )
    expect(score('Uptime Kuma Metrics Agent', 'ukma')).toBeGreaterThan(score('ukmo', 'ukma'))
  })

  it('reports the tier each match needed', () => {
    expect(match('kuma', 'kuma')!.tier).toBe(MATCH_TIERS.EXACT)
    expect(match('kuma dashboard', 'kuma')!.tier).toBe(MATCH_TIERS.PREFIX)
    expect(match('uptime kuma', 'kuma')!.tier).toBe(MATCH_TIERS.WORD_START)
    expect(match('akumal', 'kuma')!.tier).toBe(MATCH_TIERS.SUBSTRING)
    expect(match('Uptime Kuma', 'uk')!.tier).toBe(MATCH_TIERS.ACRONYM)
    expect(match('Prometheus', 'prometeus')!.tier).toBe(MATCH_TIERS.TYPO)
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

describe('acronyms', () => {
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

  // Only the initials count, so a letter that also ends a word cannot stand in for one.
  it('lands every character on a word start even where a letter repeats inside a word', () => {
    expect(match('Home Assistant Media', 'ham')!.ranges).toEqual([
      { start: 0, end: 1 },
      { start: 5, end: 6 },
      { start: 15, end: 16 },
    ])
  })
})

describe('typos', () => {
  it('finds a word with a letter missing, swapped or wrong', () => {
    expect(match('Prometheus', 'prometeus')).toBeDefined()
    expect(match('Grafana', 'grafna')).toBeDefined()
    expect(match('Grafana', 'garfana')).toBeDefined()
    expect(match('Grafana', 'grafama')).toBeDefined()
  })

  // Below four characters a single edit turns one word into another.
  it('guesses nothing for a token under four characters', () => {
    expect(match('Grafana', 'gra')).toBeDefined()
    expect(match('Grafana', 'gfa')).toBeUndefined()
    expect(match('Loki', 'lko')).toBeUndefined()
  })

  it('allows one edit up to seven characters and two from eight', () => {
    expect(match('Grafana', 'grfnaa')).toBeUndefined()
    expect(match('Prometheus', 'promteheu')).toBeDefined()
    expect(match('Prometheus', 'prmtheus')).toBeDefined()
    expect(match('Prometheus', 'prmthues')).toBeUndefined()
  })

  // A word still being typed is compared by its start, so a slip in it does not lose the target.
  it('finds a word by a mistyped start of it', () => {
    expect(match('Prometheus', 'promr')).toBeDefined()
    expect(match('Prometheus', 'promr')!.ranges).toEqual([{ start: 0, end: 5 }])
  })

  it('reads the words of a path, a name and a camel-cased one apart', () => {
    expect(match('example-group/uptime_kuma', 'kuam')).toBeDefined()
    expect(match('example.org', 'exampel')).toBeDefined()
    expect(match('UptimeKuma', 'uptmie')).toBeDefined()
  })

  it('marks the word it matched', () => {
    expect(match('my Grafana board', 'grafna')!.ranges).toEqual([{ start: 3, end: 10 }])
  })

  it('ranks one edit above two on the same word', () => {
    expect(score('Prometheus', 'prometeus')).toBeGreaterThan(score('Prometheus', 'prmetheis'))
  })
})

describe('the ranges a renderer marks up', () => {
  it('reports one contiguous range for a literal hit', () => {
    expect(match('uptime kuma', 'kuma')!.ranges).toEqual([{ start: 7, end: 11 }])
  })

  it('reports ranges ascending and non-overlapping', () => {
    const { ranges } = match('example-group/uptime-web', 'eguw')!

    for (const [index, range] of ranges.entries()) {
      expect(range.end).toBeGreaterThan(range.start)

      const previous = ranges[index - 1]
      if (previous) {
        expect(range.start).toBeGreaterThanOrEqual(previous.end)
      }
    }
  })

  // A forward pass alone misses this whenever an early letter of the token opens several words.
  it('picks the tightest run of initials when a letter opens more than one word', () => {
    const { ranges } = match('Alpha Alpha Beta', 'ab')!

    expect(ranges).toEqual([
      { start: 6, end: 7 },
      { start: 12, end: 13 },
    ])
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
    ['Uptime Kuma', 'uk'],
    ['prometheus', 'prometeus'],
    ['prometheus', 'prmetheis'],
  ] as const) {
    const value = score(text, token)

    expect(value).toBeGreaterThan(0)
    expect(value).toBeLessThan(1000)
  }
})
