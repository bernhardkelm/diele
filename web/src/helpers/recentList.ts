/**
 * Moves a value to the front of a capped, deduplicated list of recents. Newest first in every
 * caller, so `[0]` is always the last thing that happened and the cap drops the oldest.
 * @param {ReadonlyArray<string>} current - List as it stands
 * @param {string} value - Value that was just used
 * @param {number} limit - How many entries to keep
 * @returns {ReadonlyArray<string>} - The list with the value at the front
 */
export function pushRecent(
  current: ReadonlyArray<string>,
  value: string,
  limit: number,
): ReadonlyArray<string> {
  return [value, ...current.filter((entry) => entry !== value)].slice(0, limit)
}
