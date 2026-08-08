import { describe, expect, it } from 'vitest'
import { highlightPieces } from '@/helpers/highlightRanges'

/**
 * Reassembles the pieces, which must always be the text they were cut from.
 * @param {ReadonlyArray<{ text: string }>} pieces - Pieces returned by the helper
 * @returns {string} - The original text
 */
function joined(pieces: ReadonlyArray<{ text: string }>): string {
  return pieces.map((piece) => piece.text).join('')
}

describe('highlightPieces', () => {
  it('marks the stretch a query matched', () => {
    expect(highlightPieces('Uptime Kuma', 'kuma')).toEqual([
      { text: 'Uptime ', matched: false },
      { text: 'Kuma', matched: true },
    ])
  })

  it('returns the whole text unmarked when nothing matched', () => {
    expect(highlightPieces('Grafana', 'zzz')).toEqual([{ text: 'Grafana', matched: false }])
    expect(highlightPieces('Grafana', '')).toEqual([{ text: 'Grafana', matched: false }])
  })

  it('returns nothing at all for an empty text', () => {
    expect(highlightPieces('', 'kuma')).toEqual([])
    expect(highlightPieces('', '')).toEqual([])
  })

  it('never loses or duplicates a character', () => {
    for (const [text, query] of [
      ['Uptime Kuma', 'kuma'],
      ['example-group/web', 'exam web'],
      ['Grafana', 'graf'],
      ['prometheus', 'pmts'],
      ['Grafana', 'zzz'],
    ] as const) {
      expect(joined(highlightPieces(text, query)), `${text} / ${query}`).toBe(text)
    }
  })

  it('marks every token of a multi-word query', () => {
    const pieces = highlightPieces('example-group/web', 'example web')
    const marked = pieces.filter((piece) => piece.matched).map((piece) => piece.text)

    expect(marked).toContain('example')
    expect(marked).toContain('web')
  })

  // Two tokens landing on the same stretch must not produce two ranges over one span.
  it('merges overlapping matches into one piece', () => {
    const pieces = highlightPieces('grafana', 'graf grafa')

    expect(pieces.filter((piece) => piece.matched)).toHaveLength(1)
    expect(joined(pieces)).toBe('grafana')
  })

  it('alternates rather than emitting two marked pieces in a row', () => {
    const pieces = highlightPieces('example-group/web', 'exam web')

    for (const [index, piece] of pieces.entries()) {
      expect(piece.text).not.toBe('')

      const previous = pieces[index - 1]
      if (previous) {
        expect(piece.matched).not.toBe(previous.matched)
      }
    }
  })

  it('keeps a match that runs to the end of the text', () => {
    const pieces = highlightPieces('uptime kuma', 'kuma')

    expect(pieces.at(-1)).toEqual({ text: 'kuma', matched: true })
  })
})
