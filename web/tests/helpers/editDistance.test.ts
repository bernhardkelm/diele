import { describe, expect, it } from 'vitest'
import { editDistance } from '@/helpers/editDistance'

describe('editDistance', () => {
  it('reads equal strings as no edit', () => {
    expect(editDistance('grafana', 'grafana', 2)).toBe(0)
    expect(editDistance('', '', 0)).toBe(0)
  })

  it('counts an insertion, a deletion and a substitution as one edit each', () => {
    expect(editDistance('grafana', 'grafanna', 2)).toBe(1)
    expect(editDistance('grafana', 'grafna', 2)).toBe(1)
    expect(editDistance('grafana', 'grafama', 2)).toBe(1)
  })

  // Damerau rather than plain Levenshtein, which would count a swap as two.
  it('counts two swapped neighbours as one edit', () => {
    expect(editDistance('grafana', 'garfana', 2)).toBe(1)
    expect(editDistance('grafan', 'grafna', 1)).toBe(1)
  })

  it('adds edits up', () => {
    expect(editDistance('prometheus', 'prmetheis', 3)).toBe(2)
    expect(editDistance('kitten', 'sitting', 3)).toBe(3)
  })

  it('gives up past the bound, on length alone or on the way', () => {
    expect(editDistance('grafana', 'grafanaxyz', 2)).toBeUndefined()
    expect(editDistance('grafana', 'loki', 1)).toBeUndefined()
    expect(editDistance('kitten', 'sitting', 2)).toBeUndefined()
    expect(editDistance('abcd', 'wxyz', 1)).toBeUndefined()
  })

  it('compares against an empty string by length', () => {
    expect(editDistance('', 'ab', 2)).toBe(2)
    expect(editDistance('abc', '', 2)).toBeUndefined()
  })
})
