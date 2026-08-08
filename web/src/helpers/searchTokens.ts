// A path reads as its segments, so `example-group/web` searches for both of them separately
// and `exam we` finds the same repo without the two halves having to be adjacent.
const SEPARATORS = /[\s/]+/

/**
 * Splits a query into the terms every match has to satisfy.
 * @param {string} query - Raw search term as typed
 * @returns {ReadonlyArray<string>} - Lowercased tokens, empty for a blank query
 */
export function tokenize(query: string): ReadonlyArray<string> {
  return query.trim().toLowerCase().split(SEPARATORS).filter(Boolean)
}
