import { describe, expect, it } from 'vitest'
import { scoreFields } from '@/helpers/scoreFields'
import type { SearchField } from '@/helpers/searchFields'
import type { SearchToken } from '@/helpers/searchTokens'

const fields: ReadonlyArray<SearchField> = [
  { text: 'Grafana', weight: 1 },
  { text: 'example-group', weight: 0.9 },
  { text: 'metrics', weight: 0.85 },
]

/**
 * Builds the unquoted tokens a plain query splits into.
 * @param {ReadonlyArray<string>} texts - Lowercased token texts
 * @returns {ReadonlyArray<SearchToken>} - The tokens
 */
function loose(...texts: ReadonlyArray<string>): ReadonlyArray<SearchToken> {
  return texts.map((text) => ({ text, exact: false }))
}

describe('scoreFields', () => {
  it('reads no tokens as nothing to score', () => {
    expect(scoreFields(fields, loose())).toBeUndefined()
  })

  it('scores a token that hits any field', () => {
    expect(scoreFields(fields, loose('grafana'))).toBeGreaterThan(0)
    expect(scoreFields(fields, loose('metrics'))).toBeGreaterThan(0)
  })

  // A second word narrows the result rather than widening it.
  it('requires every token to hit something', () => {
    expect(scoreFields(fields, loose('grafana', 'metrics'))).toBeGreaterThan(0)
    expect(scoreFields(fields, loose('grafana', 'nothinghere'))).toBeUndefined()
  })

  it('does not match when no field carries the token', () => {
    expect(scoreFields(fields, loose('zzz'))).toBeUndefined()
    expect(scoreFields([], loose('grafana'))).toBeUndefined()
  })

  // A name match is never diluted by the fields it missed, so a token scores on its best field.
  it('takes a token best field rather than an average across all of them', () => {
    const onlyName = scoreFields([{ text: 'Grafana', weight: 1 }], loose('grafana'))
    const nameAmongMisses = scoreFields(
      [
        { text: 'Grafana', weight: 1 },
        { text: 'nothing to do with it', weight: 1 },
        { text: 'nor this', weight: 1 },
      ],
      loose('grafana'),
    )

    expect(nameAmongMisses).toBe(onlyName)
  })

  // Low enough that a term hitting nothing but a shared domain sorts under every real match.
  it('lets weight decide between two fields that match the same way', () => {
    const heavy = scoreFields([{ text: 'grafana', weight: 1 }], loose('grafana'))!
    const light = scoreFields([{ text: 'grafana', weight: 0.45 }], loose('grafana'))!

    expect(heavy).toBeGreaterThan(light)
  })

  it('averages across tokens rather than summing, so a longer query does not score higher', () => {
    const one = scoreFields([{ text: 'alpha beta', weight: 1 }], loose('alpha'))!
    const two = scoreFields([{ text: 'alpha beta', weight: 1 }], loose('alpha', 'beta'))!

    expect(two).toBeLessThan(one * 2)
  })

  // A match never scores zero, so a zero best is unambiguously "nothing matched".
  it('never returns zero for something that matched', () => {
    expect(scoreFields(fields, loose('grafana'))).not.toBe(0)
  })
})
