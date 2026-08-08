/**
 * Reads a JSON array column, tolerating anything that does not hold what it should. Columns like
 * this are written by the application but read back from a file anyone with the disk can edit, and
 * a row that predates the column having a shape is the ordinary case rather than the exception.
 * @param {string} raw - JSON text from the row
 * @param {(entry: unknown) => boolean} isValid - Whether one element is usable
 * @returns {ReadonlyArray<T>} - Parsed elements, empty when unreadable
 */
export function parseJsonArray<T>(
  raw: string,
  isValid: (entry: unknown) => boolean,
): ReadonlyArray<T> {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((entry): entry is T => isValid(entry))
  } catch {
    return []
  }
}

/**
 * Reads a JSON array of strings, which is what every such column in this schema holds.
 * @param {string} raw - JSON text from the row
 * @returns {ReadonlyArray<string>} - Strings it held, empty when unreadable
 */
export function parseStringArray(raw: string): ReadonlyArray<string> {
  return parseJsonArray<string>(raw, (entry) => typeof entry === 'string')
}
