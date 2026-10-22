/** Shorter than this, a piece of the url turns up in ordinary titles by chance. */
const MIN_PIECE = 3

/** What a piece has to be bounded by to count as a word of the title, not part of a longer one. */
const WORD_CHAR = /[\p{L}\p{N}]/u

/**
 * Lowercases a piece of text and collapses its whitespace, the form both sides are compared in.
 * @param {string} text - Text to normalise
 * @returns {string} - The comparable form
 */
function comparable(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Decodes a fragment piece, `+` as a space, leaving what does not decode as it stands.
 * @param {string} piece - Piece of the fragment, still encoded
 * @returns {string} - The decoded piece
 */
function decodePiece(piece: string): string {
  try {
    return decodeURIComponent(piece.replaceAll('+', ' '))
  } catch {
    return piece
  }
}

/**
 * Collects what a url carries beyond its origin and path: every query parameter value, decoded
 * with `+` as a space, and the fragment split on `&`, `=`, `/` and `?`.
 * @param {URL} url - The url as reported, before it is stripped
 * @returns {string[]} - Pieces long enough to compare, in comparable form
 */
function piecesOf(url: URL): string[] {
  const values = [...url.searchParams.values()]
  const fragment = url.hash
    .slice(1)
    .split(/[&=/?]/)
    .map(decodePiece)

  return [...values, ...fragment].map(comparable).filter((piece) => piece.length >= MIN_PIECE)
}

/**
 * Returns whether a piece occurs in a text as whole words: bounded on both sides by the start or
 * end of the text or by a character that is neither a letter nor a digit, so `all` is found in
 * `All of it` but not in `Install`.
 * @param {string} text - Title, in comparable form
 * @param {string} piece - Piece of the url, in comparable form
 * @returns {boolean} - True when the piece stands on its own somewhere in the text
 */
function containsWords(text: string, piece: string): boolean {
  for (let at = text.indexOf(piece); at >= 0; at = text.indexOf(piece, at + 1)) {
    const before = text.slice(0, at).at(-1) ?? ''
    const after = text.charAt(at + piece.length)

    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) {
      return true
    }
  }

  return false
}

/**
 * Returns whether a title gives away what the stored url leaves out, or is only the address. A
 * results page titles itself with the term (`Embarrassing Thing - Search` for
 * `?q=embarrassing+thing`), and a fragment can carry a token the same way, so a title holding a
 * piece of the query or fragment would keep exactly what stripping them was for. A title that
 * starts with a scheme or repeats the host is how a browser names an untitled page, and says
 * nothing the url does not. A piece counts only as whole words, so `?tab=all` leaves `Install`
 * alone.
 *
 * The visit is kept either way; only the title goes. Judged on the url as reported, since the
 * stored one no longer has the query or fragment to compare against.
 * @param {string} title - The title, already cleaned
 * @param {URL} url - The url as reported, before it is stripped
 * @returns {boolean} - True when the title should not be stored
 */
export function titleLeaksUrl(title: string, url: URL): boolean {
  const text = comparable(title)

  if (/^https?:\/\//.test(text)) {
    return true
  }

  const host = url.hostname.replace(/\.+$/, '').replace(/^www\./, '')

  // A single-label host such as `nas` is also an ordinary word, and would take every title
  // mentioning it with it.
  if (host.includes('.') && text.includes(host)) {
    return true
  }

  return piecesOf(url).some((piece) => containsWords(text, piece))
}
