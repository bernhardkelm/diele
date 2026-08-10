import { describe, expect, it } from 'vitest'
import { scoreFields } from '@/helpers/scoreFields'
import type { SearchField } from '@/helpers/searchFields'

const fields: ReadonlyArray<SearchField> = [
  { text: 'Grafana', weight: 1 },
  { text: 'example-group', weight: 0.9 },
  { text: 'metrics', weight: 0.85 },
]

describe('scoreFields', () => {
  it('reads no tokens as nothing to score', () => {
    expect(scoreFields(fields, [])).toBeUndefined()
  })

  it('scores a token that hits any field', () => {
    expect(scoreFields(fields, ['grafana'])).toBeGreaterThan(0)
    expect(scoreFields(fields, ['metrics'])).toBeGreaterThan(0)
  })

  // A second word narrows the result rather than widening it.
  it('requires every token to hit something', () => {
    expect(scoreFields(fields, ['grafana', 'metrics'])).toBeGreaterThan(0)
    expect(scoreFields(fields, ['grafana', 'nothinghere'])).toBeUndefined()
  })

  it('does not match when no field carries the token', () => {
    expect(scoreFields(fields, ['zzz'])).toBeUndefined()
    expect(scoreFields([], ['grafana'])).toBeUndefined()
  })

  // A name match is never diluted by the fields it missed, so a token scores on its best field.
  it('takes a token best field rather than an average across all of them', () => {
    const onlyName = scoreFields([{ text: 'Grafana', weight: 1 }], ['grafana'])
    const nameAmongMisses = scoreFields(
      [
        { text: 'Grafana', weight: 1 },
        { text: 'nothing to do with it', weight: 1 },
        { text: 'nor this', weight: 1 },
      ],
      ['grafana'],
    )

    expect(nameAmongMisses).toBe(onlyName)
  })

  // Low enough that a term hitting nothing but a shared domain sorts under every real match.
  it('lets weight decide between two fields that match the same way', () => {
    const heavy = scoreFields([{ text: 'grafana', weight: 1 }], ['grafana'])!
    const light = scoreFields([{ text: 'grafana', weight: 0.45 }], ['grafana'])!

    expect(heavy).toBeGreaterThan(light)
  })

  it('averages across tokens rather than summing, so a longer query does not score higher', () => {
    const one = scoreFields([{ text: 'alpha beta', weight: 1 }], ['alpha'])!
    const two = scoreFields([{ text: 'alpha beta', weight: 1 }], ['alpha', 'beta'])!

    expect(two).toBeLessThan(one * 2)
  })

  // A match never scores zero, so a zero best is unambiguously "nothing matched".
  it('never returns zero for something that matched', () => {
    expect(scoreFields(fields, ['grafana'])).not.toBe(0)
  })
})
