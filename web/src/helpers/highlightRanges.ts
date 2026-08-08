import { fuzzyMatch, type MatchRange } from '@/helpers/fuzzyMatch'
import { tokenize } from '@/helpers/searchTokens'

/** A stretch of a text, marked when the query matched it. */
export interface TextPiece {
  readonly text: string
  readonly matched: boolean
}

/**
 * Returns the spans of a text a query matched, merged and in order.
 * @param {string} text - Text to search
 * @param {string} query - Raw search term as typed
 * @returns {ReadonlyArray<MatchRange>} - Non-overlapping ranges, ascending
 */
function highlightRanges(text: string, query: string): ReadonlyArray<MatchRange> {
  const found: MatchRange[] = []

  for (const token of tokenize(query)) {
    const match = fuzzyMatch(text, token)
    if (match) {
      found.push(...match.ranges)
    }
  }

  found.sort((a, b) => a.start - b.start)

  const merged: MatchRange[] = []
  for (const range of found) {
    const last = merged.at(-1)
    if (last && range.start <= last.end) {
      if (range.end > last.end) {
        merged[merged.length - 1] = { start: last.start, end: range.end }
      }
    } else {
      merged.push(range)
    }
  }

  return merged
}

/**
 * Cuts a text into the alternating plain and matched pieces a renderer walks.
 * @param {string} text - Text to cut
 * @param {string} query - Raw search term as typed
 * @returns {ReadonlyArray<TextPiece>} - Pieces in order, empty ones dropped
 */
export function highlightPieces(text: string, query: string): ReadonlyArray<TextPiece> {
  const ranges = highlightRanges(text, query)
  if (ranges.length === 0) {
    return text ? [{ text, matched: false }] : []
  }

  const pieces: TextPiece[] = []
  let cursor = 0

  for (const range of ranges) {
    if (range.start > cursor) {
      pieces.push({ text: text.slice(cursor, range.start), matched: false })
    }
    pieces.push({ text: text.slice(range.start, range.end), matched: true })
    cursor = range.end
  }

  if (cursor < text.length) {
    pieces.push({ text: text.slice(cursor), matched: false })
  }

  return pieces
}
