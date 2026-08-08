import type { ApiProviders, ApiUser } from '@diele/common'
import { Router } from 'express'
import { config } from '#config.js'
import { badRequest, forbidden, tooManyRequests, unauthorized } from '#errors.js'
import { createInitialAdmin, findLocalUser, markSignedIn } from '#users/repository.js'
import { clearAttempts, recordAttempt, tooManyAttempts } from './attempts.js'
import { clearSessionCookie, setSessionCookie } from './cookie.js'
import { beginFlow, consumeFlow } from './flows.js'
import { beginLogin, completeLogin, logoutUrl } from './oidc.js'
import { hashPassword, spendDummyVerify, verifyPassword } from './password.js'
import { canAdmin } from './permissions.js'
import { loginSchema, setupSchema } from './schemas.js'
import {
  createSession,
  deleteOtherSessions,
  deleteSession,
  upsertUser,
  type IdentityClaims,
} from './session.js'
import { setupPending, setupTokenMatches } from './setup.js'

// Stands in for a real identity when AUTH_MODE=dev, so the frontend can be developed without
// reaching an issuer. It goes through the same session and cookie path as a real login.
const DEV_IDENTITY: IdentityClaims = {
  issuer: 'dev',
  subject: 'dev-user',
  email: 'dev@localhost',
  name: 'Local Developer',
  groups: [],
}

/**
 * Narrows a caller-supplied return target to a path inside the portal. Anything absolute is
 * discarded rather than corrected: this value arrives on a public endpoint, so honouring it
 * would turn login into an open redirect.
 * @param {unknown} raw - Value taken from the query string
 * @returns {string} - A safe same-origin path, defaulting to the portal root
 */
export function safeRedirect(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/')) {
    return '/'
  }

  // Browsers strip tabs and newlines before resolving a url, so `/\t/evil.com` reads as
  // `//evil.com` to them while passing every textual check below. Refused rather than stripped:
  // a return path has no reason to carry one.
  if ([...raw].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) {
    return '/'
  }

  // `//evil.com` and `/\evil.com` are protocol-relative, so they leave the origin despite
  // the leading slash.
  if (raw.startsWith('//') || raw.startsWith('/\\')) {
    return '/'
  }

  return raw
}

export const authRouter: Router = Router()

/**
 * Names the ways in which this deployment lets someone sign in.
 * @returns {ReadonlyArray<{ id: string; name: string }>} - Providers for the login screen
 */
function providers(): ReadonlyArray<{ id: string; name: string }> {
  if (config.authMode === 'dev') {
    return [{ id: 'dev', name: 'Local Developer' }]
  }

  if (config.authMode === 'local') {
    return [{ id: 'local', name: 'Password' }]
  }

  return [{ id: 'oidc', name: process.env.OIDC_DISPLAY_NAME ?? 'Single Sign-On' }]
}

authRouter.get('/providers', (_req, res) => {
  const payload: ApiProviders = {
    // Carried here as well as on /api/config, because the login screen is by definition
    // unauthenticated and would otherwise be the one page unable to show the brand.
    brand: config.brand,
    mode: config.authMode,
    // Says that an account still has to be created, never whether creating one is guarded.
    setupRequired: setupPending(),
    providers: providers(),
  }

  res.json(payload)
})

authRouter.get('/login', (req, res, next) => {
  const redirectTo = safeRedirect(req.query.redirect)
  const remember = req.query.remember === '1'

  if (config.authMode === 'dev') {
    startSession(res, upsertUser(DEV_IDENTITY), [], req.get('user-agent'), remember)
    res.redirect(redirectTo)
    return
  }

  // Local mode has no handshake to begin: the credentials go to POST /login instead. This is a
  // navigation target, so it sends the browser back to the portal, where the form is. Answering
  // with an error would strand whoever followed a stale link on a bare JSON page.
  if (config.authMode === 'local') {
    res.redirect(redirectTo)
    return
  }

  beginLogin()
    .then((handshake) => {
      beginFlow(handshake.state, {
        codeVerifier: handshake.codeVerifier,
        nonce: handshake.nonce,
        redirectTo,
        remember,
      })

      res.redirect(handshake.url)
    })
    .catch(next)
})

authRouter.post('/login', (req, res, next) => {
  if (config.authMode !== 'local') {
    next(badRequest('password login is not enabled'))
    return
  }

  const { username, password, remember } = loginSchema.parse(req.body)
  const ip = req.ip ?? 'unknown'

  if (tooManyAttempts(username, ip)) {
    res.set('Retry-After', '900')
    next(tooManyRequests('too many sign-in attempts, try again in a few minutes'))
    return
  }

  recordAttempt(username, ip)

  const user = findLocalUser(username)

  // An account with no password is one an issuer created, and is not something to sign in to
  // here. It takes the same path as a name nobody holds, so neither can be told from the other.
  const check = user?.passwordHash
    ? verifyPassword(password, user.passwordHash)
    : spendDummyVerify(password).then(() => false)

  check
    .then((ok) => {
      if (!ok || !user) {
        next(unauthorized('invalid username or password'))
        return
      }

      clearAttempts(username)
      // Signing in again would otherwise leave the previous session live and unreachable, which
      // at ninety days is a credential nobody can see to revoke.
      deleteOtherSessions(user.id)
      markSignedIn(user.id)
      startSession(res, user.id, [], req.get('user-agent'), remember)

      res.json({ ok: true })
    })
    .catch(next)
})

authRouter.post('/setup', (req, res, next) => {
  if (config.authMode !== 'local') {
    next(badRequest('this portal does not manage its own accounts'))
    return
  }

  if (!setupPending()) {
    next(forbidden('this portal already has an account'))
    return
  }

  const { username, password, name, token } = setupSchema.parse(req.body)

  if (!setupTokenMatches(token)) {
    next(forbidden('that setup token is not the one this portal printed'))
    return
  }

  hashPassword(password)
    .then((passwordHash) => {
      const userId = createInitialAdmin({ username, name: name ?? null, passwordHash })
      startSession(res, userId, [], req.get('user-agent'), true)

      res.status(201).json({ ok: true })
    })
    .catch(next)
})

authRouter.get('/callback', (req, res, next) => {
  const state = req.query.state
  if (typeof state !== 'string') {
    next(badRequest('missing state'))
    return
  }

  const flow = consumeFlow(state)
  if (!flow) {
    next(badRequest('unknown or expired login attempt'))
    return
  }

  // Built from the configured origin rather than the request headers, which a proxy in front
  // of this process would otherwise decide.
  const currentUrl = new URL(req.originalUrl, config.publicOrigin)

  completeLogin(currentUrl, flow.codeVerifier, state, flow.nonce)
    .then((claims) => {
      const userId = upsertUser(claims)
      startSession(res, userId, claims.groups ?? [], req.get('user-agent'), flow.remember)
      res.redirect(safeRedirect(flow.redirectTo))
    })
    .catch(next)
})

authRouter.post('/logout', (req, res, next) => {
  if (req.sessionId) {
    deleteSession(req.sessionId)
  }

  clearSessionCookie(res)

  // Only a real issuer has an end-session endpoint to send anyone to. Every other mode answers
  // here, or the call reaches OIDC discovery with no issuer configured and fails after the
  // session has already been destroyed, leaving the client believing it is still signed in.
  if (config.authMode !== 'oidc') {
    res.json({ ok: true })
    return
  }

  logoutUrl(config.publicOrigin)
    .then((url) => {
      res.json({ ok: true, logoutUrl: url ?? null })
    })
    .catch(next)
})

authRouter.get('/me', (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'authentication required' })
    return
  }

  const payload: ApiUser = {
    id: req.user.id,
    email: req.user.email,
    name: req.user.name,
    picture: req.user.picture,
    // A hint for the client, so it knows whether to offer the mode switch. The admin routes
    // enforce the same thing themselves and never trust this.
    canAdmin: canAdmin(req.user),
  }

  res.json(payload)
})

/**
 * Opens a session for a user and puts the cookie on the response.
 *
 * Takes a user id rather than claims, because a local account is looked up rather than vouched
 * for: routing it through `upsertUser` would overwrite its name and email with the nulls a
 * password login has nothing to fill them from.
 * @param {import('express').Response} res - Response to set the cookie on
 * @param {number} userId - User to open the session for
 * @param {ReadonlyArray<string>} groups - Group claims to carry alongside it
 * @param {string | undefined} userAgent - Client that logged in
 * @param {boolean} remember - Whether to use the longer idle window
 * @returns {void}
 */
function startSession(
  res: import('express').Response,
  userId: number,
  groups: ReadonlyArray<string>,
  userAgent: string | undefined,
  remember: boolean,
): void {
  const sessionId = createSession(userId, groups, userAgent, remember)
  setSessionCookie(res, sessionId)
}
