/** Half-open span of one word in a text, `[start, end)`. */
export interface WordSpan {
  readonly start: number
  readonly end: number
}

// letters of any script, so `Hintergründe` stays one word rather than breaking at the umlaut
const WORD_CHAR = /[\p{L}\p{N}]/u
const ASCII_LIMIT = 128

/**
 * Returns whether a character belongs to a word. Most of what is searched is ascii, which is
 * told apart by its code alone, since this runs for every character on every keystroke.
 * @param {string} character - One character of the text
 * @returns {boolean} - True for a letter or a digit of any script
 */
function isWordChar(character: string): boolean {
  const code = character.charCodeAt(0)
  if (code >= ASCII_LIMIT) {
    return WORD_CHAR.test(character)
  }

  const lower = code | 0x20
  return (lower >= 0x61 && lower <= 0x7a) || (code >= 0x30 && code <= 0x39)
}

/**
 * Returns whether a position sits on a camel hump, a capital right after a lowercase letter.
 * @param {string} text - Text in its original casing, which is what carries the humps
 * @param {number} index - Position to test, never the first of a word
 * @returns {boolean} - True on a hump
 */
function isHump(text: string, index: number): boolean {
  const previous = text[index - 1] ?? ''
  const current = text[index] ?? ''

  return previous === previous.toLowerCase() && current !== current.toLowerCase()
}

/**
 * Splits a text into its words: runs of letters and digits, cut at every separator (`-`, `_`,
 * `/`, `.`, whitespace and anything else that is neither) and at every camel hump, so
 * `miwo_datasets` and `UptimeKuma` read as two words each.
 * @param {string} text - Text in its original casing
 * @returns {ReadonlyArray<WordSpan>} - Words in order, never empty
 */
export function wordSpans(text: string): ReadonlyArray<WordSpan> {
  const spans: WordSpan[] = []
  let start = -1

  for (let index = 0; index <= text.length; index += 1) {
    const inWord = index < text.length && isWordChar(text[index]!)

    if (start !== -1 && (!inWord || isHump(text, index))) {
      spans.push({ start, end: index })
      start = -1
    }

    if (inWord && start === -1) {
      start = index
    }
  }

  return spans
}
