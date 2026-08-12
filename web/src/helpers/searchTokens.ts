// A path reads as its segments, so `example-group/web` searches for both of them separately
// and `exam we` finds the same repo without the two halves having to be adjacent.
const SEPARATORS = /[\s/]+/

const QUOTE = '"'

/** One term every match has to satisfy. */
export interface SearchToken {
  /** Lowercased text to look for */
  readonly text: string
  /** True when it was quoted, which is what holds it to a literal hit */
  readonly exact: boolean
}

/**
 * Splits a query into the terms every match has to satisfy.
 *
 * Quotes turn off both of the conveniences the rest of the search is built on: what they hold is
 * one term however many spaces or slashes are inside it, and it only counts where it appears
 * literally. That is what makes them worth typing, since a term short or common enough to match
 * half the portal has no other way to say it means only itself.
 *
 * A quote left open runs to the end of the query, so a phrase behaves as one while it is still
 * being typed rather than only once it is closed.
 * @param {string} query - Raw search term as typed
 * @returns {ReadonlyArray<SearchToken>} - Tokens in the order they were typed, empty for a blank query
 */
export function tokenize(query: string): ReadonlyArray<SearchToken> {
  const tokens: SearchToken[] = []
  let loose = ''
  let phrase: string | undefined

  /**
   * Splits what has been collected outside quotes and adds it.
   * @returns {void}
   */
  function flushLoose(): void {
    for (const part of loose.split(SEPARATORS)) {
      if (part) {
        tokens.push({ text: part, exact: false })
      }
    }

    loose = ''
  }

  /**
   * Adds what has been collected inside quotes, unless it is nothing but space.
   * @returns {void}
   */
  function flushPhrase(): void {
    const text = phrase?.trim()
    if (text) {
      tokens.push({ text, exact: true })
    }

    phrase = undefined
  }

  for (const character of query.toLowerCase()) {
    if (character === QUOTE) {
      if (phrase === undefined) {
        flushLoose()
        phrase = ''
      } else {
        flushPhrase()
      }

      continue
    }

    if (phrase === undefined) {
      loose += character
    } else {
      phrase += character
    }
  }

  if (phrase === undefined) {
    flushLoose()
  } else {
    flushPhrase()
  }

  return tokens
}
