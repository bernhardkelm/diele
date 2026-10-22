/**
 * Returns the Damerau-Levenshtein distance between two strings, in its optimal string alignment
 * form: an insertion, a deletion, a substitution and a swap of two neighbouring characters each
 * count as one edit. The search calls this on every keystroke for every word it holds, so it
 * gives up as soon as the distance can no longer stay within the bound.
 * @param {string} a - First string
 * @param {string} b - Second string
 * @param {number} max - Most edits worth counting
 * @returns {number | undefined} - Distance, or undefined when it exceeds `max`
 */
export function editDistance(a: string, b: string, max: number): number | undefined {
  if (Math.abs(a.length - b.length) > max) {
    return undefined
  }

  if (a === b) {
    return 0
  }

  // three rolling rows, since a swap reads the row two above the current one
  let before: number[] = []
  let previous: number[] = []
  let current: number[] = []

  for (let column = 0; column <= b.length; column += 1) {
    before.push(0)
    previous.push(column)
    current.push(0)
  }

  for (let row = 1; row <= a.length; row += 1) {
    current[0] = row
    let rowMin = row

    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1
      let value = Math.min(
        previous[column]! + 1,
        current[column - 1]! + 1,
        previous[column - 1]! + cost,
      )

      if (row > 1 && column > 1 && a[row - 1] === b[column - 2] && a[row - 2] === b[column - 1]) {
        value = Math.min(value, before[column - 2]! + 1)
      }

      current[column] = value
      rowMin = Math.min(rowMin, value)
    }

    // no cell of a later row can drop below the smallest of this one, swaps included
    if (rowMin > max) {
      return undefined
    }

    ;[before, previous, current] = [previous, current, before]
  }

  const distance = previous[b.length]!

  return distance <= max ? distance : undefined
}
