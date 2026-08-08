import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { config } from '#config.js'
import { forbidden, unauthorized } from '#errors.js'
import { canAdmin } from './permissions.js'
import { readSession, touchSession } from './session.js'

// Deny by default: only these paths answer without a session. Listing them one by one rather
// than by prefix means a new route is protected because nobody did anything, which is the only
// arrangement that survives someone forgetting. `/api/auth/` used to be public wholesale, which
// quietly made every route added to that router public too.
//
// `/logout` and `/me` are here because they answer an anonymous caller themselves rather than
// needing a session to reach.
const PUBLIC_PATHS = [
  '/status',
  '/api/auth/providers',
  '/api/auth/login',
  '/api/auth/callback',
  '/api/auth/setup',
  '/api/auth/logout',
  '/api/auth/me',
]

/**
 * Returns whether a path is reachable without being signed in.
 * @param {string} path - Request path, without query string
 * @returns {boolean} - True when the path is public
 */
export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.includes(path)
}

/**
 * Resolves the session cookie to a user and hangs it off the request. Never rejects: a
 * missing or stale cookie simply leaves the request anonymous, which the public routes are
 * allowed to be.
 * @returns {RequestHandler} - Express middleware
 */
export function attachSession(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const id: unknown = req.cookies?.[config.session.cookieName]
    if (typeof id !== 'string' || id.length === 0) {
      next()
      return
    }

    const user = readSession(id)
    if (!user) {
      next()
      return
    }

    req.user = user
    req.sessionId = id
    touchSession(id)
    next()
  }
}

/**
 * Rejects anonymous requests to anything not on the public list.
 * @returns {RequestHandler} - Express middleware
 */
export function requireSession(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (isPublicPath(req.path) || req.user) {
      next()
      return
    }

    next(unauthorized())
  }
}

/**
 * Rejects signed-in users who may not change the portal's configuration. Mounted on the admin
 * router rather than checked in the client: the mode switch there is a convenience, and a
 * request that reaches this process must stand on its own.
 * @returns {RequestHandler} - Express middleware
 */
export function requireAdmin(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(unauthorized())
      return
    }

    if (!canAdmin(req.user)) {
      next(forbidden('administration is not permitted for this account'))
      return
    }

    next()
  }
}

/**
 * Rejects state-changing requests that did not originate from the portal itself. The session
 * cookie is SameSite=Lax, which already keeps it off cross-site form posts; this is the
 * second lock, and it is what covers the case of Lax being loosened later.
 * @returns {RequestHandler} - Express middleware
 */
export function requireSameOrigin(): RequestHandler {
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS'])

  return (req: Request, _res: Response, next: NextFunction) => {
    if (safeMethods.has(req.method)) {
      next()
      return
    }

    const origin = req.get('origin')
    // Same-origin requests from older clients may omit Origin entirely; Sec-Fetch-Site then
    // carries the answer, and browsers that send neither cannot make a cross-site request
    // with credentials in the first place.
    const site = req.get('sec-fetch-site')

    if (origin === config.publicOrigin || (!origin && (!site || site === 'same-origin'))) {
      next()
      return
    }

    next(unauthorized('cross-origin request rejected'))
  }
}
