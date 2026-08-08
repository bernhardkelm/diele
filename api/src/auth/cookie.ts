import type { CookieOptions, Response } from 'express'
import { config } from '#config.js'

/**
 * Builds the cookie flags, shared by the calls that set and clear it so they cannot drift
 * apart, which would leave a cookie that cannot be cleared.
 * @returns {CookieOptions} - Flags for the session cookie
 */
export function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: config.session.secure,
    // Lax, not Strict: the browser arrives back from the issuer as a top-level navigation,
    // and Strict would withhold the cookie on exactly that request.
    sameSite: 'lax',
    path: '/',
  }
}

/**
 * Puts a session id on the response.
 *
 * The cookie is given the longest window the portal ever issues, whatever this session's own
 * window is. It is only the bearer: the row decides when the session ends, and it rolls forward
 * on use, so a cookie that expired on its own schedule would cut a live session short. A cookie
 * that outlives its row is harmless, because reading it then resolves to nobody.
 * @param {Response} res - Response to set the cookie on
 * @param {string} sessionId - Session the cookie should carry
 * @returns {void}
 */
export function setSessionCookie(res: Response, sessionId: string): void {
  res.cookie(config.session.cookieName, sessionId, {
    ...cookieOptions(),
    maxAge: config.session.rememberMaxAgeMs,
  })
}

/**
 * Removes the session cookie.
 * @param {Response} res - Response to clear the cookie on
 * @returns {void}
 */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.session.cookieName, cookieOptions())
}
