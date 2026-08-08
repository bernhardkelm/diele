/**
 * Reads a colour variable, refusing anything that is not a plain hex. The value ends up in a
 * css custom property, so allowing arbitrary text would let it carry more than a colour.
 *
 * The leading `#` is optional because it is a trap: `.env` treats an unquoted `#` as the start
 * of a comment, so `FOO=#e8756a` parses as an empty string. Both `#e8756a` and `e8756a` are
 * accepted, and a variable that is set but empty says so rather than silently defaulting.
 * @param {string} name - Environment variable the value came from, for the warning
 * @param {string | undefined} raw - Value as read from the environment
 * @param {string} fallback - Colour to use when unset or malformed
 * @returns {string} - A six-digit hex colour, with its leading `#`
 */
export function hexOr(name: string, raw: string | undefined, fallback: string): string {
  if (raw === undefined) {
    return fallback
  }

  const value = raw.trim()
  if (value.length === 0) {
    console.warn(
      `${name} is set but empty. An unquoted '#' starts a comment in .env, so write it as ` +
        `${name}="${fallback}" or drop the '#'. Falling back to ${fallback}.`,
    )
    return fallback
  }

  const normalised = value.startsWith('#') ? value : `#${value}`
  if (!/^#[0-9a-fA-F]{6}$/.test(normalised)) {
    console.warn(`${name} is not a 6-digit hex colour, falling back to ${fallback}`)
    return fallback
  }

  return normalised
}

/**
 * Reads a variable that has to be a positive whole number. A bare `Number()` accepts far too
 * much here: an empty value becomes 0, which for a port means a random one the operator never
 * chose, and anything unparseable becomes NaN, which for a session window survives all the way
 * into `datetime('now', '+NaN seconds')` and turns every login into a 500 while the process
 * still looks healthy. Both are worth refusing to boot over.
 * @param {string} name - Environment variable the value came from
 * @param {string | undefined} raw - Value as read from the environment
 * @param {number} fallback - Value to use when unset
 * @returns {number} - The parsed number
 */
export function positiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined) {
    return fallback
  }

  const value = raw.trim()
  if (value.length === 0) {
    throw new Error(`${name} is set but empty. Remove it to use the default of ${fallback}.`)
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name}=${value} is not a positive whole number.`)
  }

  return parsed
}

/**
 * Resolves whether the session cookie is marked `Secure`. `auto` derives it from the scheme the
 * portal is actually served on, which is what almost every instance wants; `true` and `false`
 * are deliberate overrides.
 *
 * The sentinel is what lets `.env` carry this variable live like every other one. The derivation
 * can only run while no explicit value is set, so a literal default would replace it, and a
 * literal `false` would hold the cookie insecure on an https origin without saying so.
 * @param {string | undefined} raw - Value of SESSION_COOKIE_SECURE
 * @param {string} origin - Origin the browser reaches the portal on
 * @returns {boolean} - True when the cookie should carry `Secure`
 */
export function cookieSecure(raw: string | undefined, origin: string): boolean {
  const requested = raw?.trim().toLowerCase()
  if (requested === undefined || requested.length === 0 || requested === 'auto') {
    return origin.startsWith('https://')
  }

  if (requested !== 'true' && requested !== 'false') {
    console.warn(
      `SESSION_COOKIE_SECURE=${requested} is not auto, true or false, deriving it from ` +
        `PUBLIC_ORIGIN instead`,
    )
    return origin.startsWith('https://')
  }

  return requested === 'true'
}

/**
 * Resolves what express may treat as a trusted proxy. Unset means none, which is what a process
 * reachable without one in front needs. A hop count covers the ordinary reverse-proxy case, and
 * anything else is handed over as written, which is how a subnet or one of express's own names
 * like `loopback` arrives.
 * @param {string | undefined} raw - Value of TRUST_PROXY
 * @returns {boolean | number | string} - Value for express's `trust proxy` setting
 */
export function parseTrustProxy(raw: string | undefined): boolean | number | string {
  const original = raw?.trim()
  if (original === undefined || original.length === 0) {
    return false
  }

  const normalised = original.toLowerCase()
  if (normalised === 'false' || normalised === 'off') {
    return false
  }

  if (normalised === 'true' || normalised === 'on') {
    return true
  }

  const hops = Number(normalised)
  if (Number.isInteger(hops) && hops >= 0) {
    return hops
  }

  return original
}
