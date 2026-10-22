import { describe, expect, it } from 'vitest'
import { allowedEdits, typoMatch } from '@/helpers/typoMatch'

describe('allowedEdits', () => {
  it('allows none below four characters, one up to seven and two from eight', () => {
    expect(allowedEdits(3)).toBe(0)
    expect(allowedEdits(4)).toBe(1)
    expect(allowedEdits(7)).toBe(1)
    expect(allowedEdits(8)).toBe(2)
    expect(allowedEdits(20)).toBe(2)
  })
})

describe('typoMatch', () => {
  it('finds the word a token is a slip away from', () => {
    expect(typoMatch('Uptime Kuma', 'kuam')).toEqual({ start: 7, end: 11, edits: 1 })
  })

  it('compares a token with the start of a longer word', () => {
    expect(typoMatch('Prometheus', 'promr')).toEqual({ start: 0, end: 5, edits: 1 })
  })

  it('prefers the word with fewer edits', () => {
    expect(typoMatch('prmetheis prometeus', 'prometheus')).toEqual({
      start: 10,
      end: 19,
      edits: 1,
    })
  })

  it('never reaches across words', () => {
    expect(typoMatch('pro metheus', 'prometheus')).toBeUndefined()
  })

  it('refuses a token too short to guess at', () => {
    expect(typoMatch('Loki', 'lko')).toBeUndefined()
  })
})
