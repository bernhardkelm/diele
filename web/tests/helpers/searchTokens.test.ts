import { describe, expect, it } from 'vitest'
import { tokenize } from '@/helpers/searchTokens'

/**
 * Reduces the tokens to the texts they carry, for the cases that say nothing about quoting.
 * @param {string} query - Raw search term as typed
 * @returns {ReadonlyArray<string>} - The token texts
 */
function texts(query: string): ReadonlyArray<string> {
  return tokenize(query).map((token) => token.text)
}

describe('tokenize', () => {
  it('splits on whitespace and lowercases', () => {
    expect(texts('Uptime  Kuma')).toEqual(['uptime', 'kuma'])
  })

  // A path reads as its segments, so `exam we` finds the same repo without the two halves
  // having to be adjacent.
  it('splits a path into its segments', () => {
    expect(texts('example-group/web')).toEqual(['example-group', 'web'])
    expect(texts('a/b/c')).toEqual(['a', 'b', 'c'])
  })

  it('drops the empty pieces leading, trailing and repeated separators leave behind', () => {
    expect(texts('  /a//b/  ')).toEqual(['a', 'b'])
  })

  it('reads a blank query as no tokens at all', () => {
    for (const query of ['', '   ', '\t\n', '///']) {
      expect(tokenize(query)).toEqual([])
    }
  })

  it('marks an ordinary term as one the search may guess at', () => {
    expect(tokenize('kuma')).toEqual([{ text: 'kuma', exact: false }])
  })
})

describe('a quoted term', () => {
  it('is one token however many separators it holds', () => {
    expect(tokenize('"example-group/web"')).toEqual([{ text: 'example-group/web', exact: true }])
    expect(tokenize('"uptime kuma"')).toEqual([{ text: 'uptime kuma', exact: true }])
  })

  it('sits among the loose ones in the order they were typed', () => {
    expect(tokenize('prod "example-group/web" api')).toEqual([
      { text: 'prod', exact: false },
      { text: 'example-group/web', exact: true },
      { text: 'api', exact: false },
    ])
  })

  it('is lowercased like everything else', () => {
    expect(tokenize('"Uptime Kuma"')).toEqual([{ text: 'uptime kuma', exact: true }])
  })

  it('keeps the spaces inside it but not the ones at its edges', () => {
    expect(tokenize('"  uptime  kuma  "')).toEqual([{ text: 'uptime  kuma', exact: true }])
  })

  // A phrase behaves as one while it is still being typed rather than only once it is closed.
  it('runs to the end of the query when the quote is left open', () => {
    expect(tokenize('"example-group/we')).toEqual([{ text: 'example-group/we', exact: true }])
    expect(tokenize('prod "uptime ku')).toEqual([
      { text: 'prod', exact: false },
      { text: 'uptime ku', exact: true },
    ])
  })

  it('is nothing at all when it holds nothing', () => {
    expect(tokenize('""')).toEqual([])
    expect(tokenize('"   "')).toEqual([])
    expect(tokenize('"')).toEqual([])
  })

  it('closes the loose term it opens against', () => {
    expect(tokenize('web"kuma"')).toEqual([
      { text: 'web', exact: false },
      { text: 'kuma', exact: true },
    ])
  })
})
