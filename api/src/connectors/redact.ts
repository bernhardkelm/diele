import { Buffer } from 'node:buffer'

/** Shorter than this is not a credential worth masking, and masking it would eat prose. */
const MIN_SECRET_LENGTH = 8

const REDACTED = '[redacted]'

/**
 * Lists the forms a credential can take in text a source sent back. An error tends to quote the
 * request that caused it, and a quoted request carries the value encoded rather than as entered,
 * so matching only what is stored leaves the encoded copy in place.
 * @param {string} value - Credential as it is stored
 * @returns {ReadonlyArray<string>} - Forms to look for, longest first
 */
function formsOf(value: string): ReadonlyArray<string> {
  const forms = new Set<string>([
    value,
    encodeURIComponent(value),
    // the json escaping a body echoed back verbatim would carry it in
    JSON.stringify(value).slice(1, -1),
    Buffer.from(value, 'utf8').toString('base64'),
    Buffer.from(value, 'utf8').toString('base64url'),
  ])

  // Longest first: a shorter form can be a prefix of a longer one, and replacing the short one
  // first would leave the tail of the long one behind next to a `[redacted]`.
  return [...forms]
    .filter((form) => form.length >= MIN_SECRET_LENGTH)
    .sort((a, b) => b.length - a.length)
}

/**
 * Removes stored credentials from text that is about to be written to the database or served.
 * A source's error message tends to echo the request that caused it, and `last_error` is read
 * by anyone who can see the admin view while `/api/entries` is not admin-gated at all.
 * @param {string} text - Message as the source produced it
 * @param {Readonly<Record<string, string>>} secrets - Credentials the connector holds
 * @returns {string} - The message with every credential replaced
 */
export function redactSecrets(text: string, secrets: Readonly<Record<string, string>>): string {
  let result = text

  for (const value of Object.values(secrets)) {
    if (value.length < MIN_SECRET_LENGTH) {
      continue
    }

    for (const form of formsOf(value)) {
      result = result.split(form).join(REDACTED)
    }
  }

  return result
}

/**
 * Turns whatever was thrown into a message worth storing.
 *
 * `fetch` reports every transport failure as the same `fetch failed`, with what actually went
 * wrong in `cause.code`: a refused port, a wrong scheme and an unresolvable host are one
 * message otherwise, and those are the three most likely things to be wrong with an address
 * someone has just typed.
 * @param {unknown} cause - Error raised by a run
 * @returns {string} - One line describing it
 */
export function messageOf(cause: unknown): string {
  if (!(cause instanceof Error)) {
    return String(cause)
  }

  // The code alone, not the reason's message: OpenSSL's runs to several lines of its own.
  const code = (cause.cause as NodeJS.ErrnoException | undefined)?.code

  return code ? `${cause.message} (${code})` : cause.message
}
