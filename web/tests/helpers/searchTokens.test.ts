import { describe, expect, it } from 'vitest'
import { tokenize } from '@/helpers/searchTokens'

describe('tokenize', () => {
  it('splits on whitespace and lowercases', () => {
    expect(tokenize('Uptime  Kuma')).toEqual(['uptime', 'kuma'])
  })

  // A path reads as its segments, so `exam we` finds the same repo without the two halves
  // having to be adjacent.
  it('splits a path into its segments', () => {
    expect(tokenize('example-group/web')).toEqual(['example-group', 'web'])
    expect(tokenize('a/b/c')).toEqual(['a', 'b', 'c'])
  })

  it('drops the empty pieces leading, trailing and repeated separators leave behind', () => {
    expect(tokenize('  /a//b/  ')).toEqual(['a', 'b'])
  })

  it('reads a blank query as no tokens at all', () => {
    for (const query of ['', '   ', '\t\n', '///']) {
      expect(tokenize(query)).toEqual([])
    }
  })
})
