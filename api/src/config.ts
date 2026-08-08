import { resolve } from 'node:path'
import type { AuthMode } from '@diele/common'
import dotenv from 'dotenv'
import { cookieSecure, hexOr, parseTrustProxy, positiveInt } from './configValues.js'
import { parseKeyring, type SecretKeyring } from './secrets/keys.js'

// Every file is optional and none overrides a variable the environment already carries, so an
// image configured the ordinary way is unaffected by whichever of them happen to exist.
//
// dotenv keeps the first value it sees, so this array reads most specific first: the nearest
// scope wins outright, and within a scope the untracked file beats the committed one. That is
// the usual monorepo convention (a package's own file over the repo's) composed with the usual
// dotenv one (`.local` over committed).
//
// It is only safe because the committed package files ship with every line commented out. Were
// one to carry a live value, it would outrank the repo-wide `.env` that people actually edit.
//
// One level up from this module either way: `src/` while tsx runs it, `dist/` once built.
const packageRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(packageRoot, '..')
dotenv.config({
  path: [
    resolve(packageRoot, '.env.local'),
    resolve(packageRoot, '.env'),
    resolve(repoRoot, '.env.local'),
    resolve(repoRoot, '.env'),
  ],
  quiet: true,
})

// `local` is the fallback because it is the mode that needs nothing configured and still holds
// the door: the first account is created through a setup form gated by a token printed at
// startup, so an unclaimed instance is not an open one. A misspelled value therefore lands on
// the safe mode rather than refusing to boot, and the warning below says it happened.
const AUTH_MODES: ReadonlyArray<AuthMode> = ['oidc', 'dev', 'local']

const requested = process.env.AUTH_MODE
const authMode: AuthMode = AUTH_MODES.find((mode) => mode === requested) ?? 'local'

if (requested !== undefined && requested !== authMode) {
  console.warn(`AUTH_MODE=${requested} is not a known mode, falling back to ${authMode}`)
}

/**
 * Reads a variable that is only required in `oidc` mode.
 * @param {string} name - Environment variable to read
 * @returns {string} - Its value, or an empty string while running in another mode
 */
function requiredForOidc(name: string): string {
  const value = process.env[name]
  if (value && value.length > 0) {
    return value
  }

  if (authMode !== 'oidc') {
    return ''
  }

  throw new Error(`${name} must be set when AUTH_MODE=oidc`)
}

// Origin the browser reaches the portal on, which is the frontend's own origin: in
// production nginx serves both from one host, and locally the vite dev server proxies /api
// to this process. The redirect uri is derived from it, so it must match what the issuer has
// registered, trailing slash included or excluded consistently.
const publicOrigin = (process.env.PUBLIC_ORIGIN ?? 'http://localhost:5173').replace(/\/+$/, '')

// Resolved from the repo root rather than the working directory, so the database lands in the
// same place whether npm ran from the root or from this package — the two differ, and a
// cwd-relative default would quietly give each its own file. An absolute DB_PATH is used as it
// stands, which is how a container points this at a mounted volume.
const dbPath = resolve(repoRoot, process.env.DB_PATH ?? 'data/diele.db')

// Annotated rather than inferred: `config` is `as const`, and inferring this through the
// modules that read it back leaves the field `unknown` at some call sites and not others.
const secrets: SecretKeyring = parseKeyring(process.env.DIELE_SECRET_KEYS)

// What express may believe about `X-Forwarded-For`. Nothing, unless a deployment says otherwise:
// `req.ip` is the only key the login limiter has, and a process reachable without a proxy in
// front lets any caller write that header and rotate past both of its caps.
const trustProxy: boolean | number | string = parseTrustProxy(process.env.TRUST_PROXY)

export const config = {
  port: positiveInt('PORT', process.env.PORT, 3000),
  publicOrigin,
  authMode,
  dbPath,
  trustProxy,
  // The wordmark, the line under it, and the accent. Served rather than built in, so a second
  // deployment is a value change and a restart rather than a rebuild of the frontend.
  brand: {
    title: process.env.BRAND_TITLE ?? 'diele',
    subtitle: process.env.BRAND_SUBTITLE ?? 'start page',
    // The same green the status dots use, one value per theme so each keeps its contrast. A
    // portal that has set no colour then reads as deliberate rather than as a missing value,
    // and it already agrees with the one other colour the page shows on its own.
    accentLight: hexOr('BRAND_ACCENT_LIGHT', process.env.BRAND_ACCENT_LIGHT, '#16a34a'),
    accentDark: hexOr('BRAND_ACCENT_DARK', process.env.BRAND_ACCENT_DARK, '#22c55e'),
  },
  // Keys connector credentials are sealed with. An unusable ring is not fatal: connectors stop
  // syncing and say so, while the portal keeps painting and signing people in.
  secrets,
  local: {
    // Creating the first account is the one privileged action there is nobody to authenticate
    // for, and the portal is reachable from the internet before anyone has claimed it. Gating
    // it on a value only whoever can read the server's environment or its log holds is what
    // stops a stranger getting there first. Generated and printed at boot when unset.
    setupToken: process.env.LOCAL_SETUP_TOKEN ?? '',
  },
  oidc: {
    issuer: requiredForOidc('OIDC_ISSUER'),
    clientId: requiredForOidc('OIDC_CLIENT_ID'),
    clientSecret: requiredForOidc('OIDC_CLIENT_SECRET'),
    scopes: process.env.OIDC_SCOPES ?? 'openid email profile',
    redirectUri: `${publicOrigin}/api/auth/callback`,
  },
  session: {
    cookieName: process.env.SESSION_COOKIE_NAME ?? 'diele_session',
    // Both windows are idle time, not lifetime: the session rolls forward on use, so these
    // are how long the portal may go untouched before it asks again. The portal is a new tab
    // page, so anything short would interrupt someone who uses it every day.
    maxAgeMs: positiveInt('SESSION_MAX_AGE_MS', process.env.SESSION_MAX_AGE_MS, 24 * 60 * 60_000),
    // Chosen at login by the `remember me` box, for the case where typing a password again is
    // the cost, rather than a redirect the issuer answers silently.
    rememberMaxAgeMs: positiveInt(
      'SESSION_REMEMBER_MAX_AGE_MS',
      process.env.SESSION_REMEMBER_MAX_AGE_MS,
      90 * 24 * 60 * 60_000,
    ),
    // Derived from the scheme the portal is actually served on, which is the only thing this
    // depends on. Keying it off the auth mode instead used to send a secure cookie to an http
    // origin, where the browser drops it silently: the login answers 200 and the very next
    // request is anonymous, with nothing on either side saying why.
    secure: cookieSecure(process.env.SESSION_COOKIE_SECURE, publicOrigin),
  },
} as const
