import * as client from 'openid-client'
import { config } from '#config.js'
import type { IdentityClaims } from './session.js'

export interface CompletedLogin {
  readonly claims: IdentityClaims
  /** Presented back to the issuer as `id_token_hint` when the session it opens is signed out */
  readonly idToken: string | undefined
}

export interface LoginHandshake {
  /** Where to send the browser to authenticate */
  readonly url: string
  /** Correlates the callback with the stored verifier, and guards the callback against forgery */
  readonly state: string
  readonly codeVerifier: string
  /** Binds the id token to this handshake, so one issued for another cannot be replayed into it */
  readonly nonce: string
}

let discovered: Promise<client.Configuration> | null = null

/**
 * Discovers the issuer's metadata, once per process. Deliberately lazy: an issuer that is
 * unreachable at boot then costs the first login attempt rather than the whole API, and a
 * failed attempt is not cached.
 * @returns {Promise<client.Configuration>} - Client configuration for the configured issuer
 */
export function getOidcConfig(): Promise<client.Configuration> {
  if (!discovered) {
    discovered = client
      .discovery(new URL(config.oidc.issuer), config.oidc.clientId, config.oidc.clientSecret)
      .catch((error: unknown) => {
        discovered = null
        throw error
      })
  }

  return discovered
}

/**
 * Starts a login: generates the PKCE pair and builds the url the browser is sent to. The
 * verifier and state have to outlive the redirect, so the caller stores them.
 * @returns {Promise<LoginHandshake>} - Authorization url plus the values the callback needs
 */
export async function beginLogin(): Promise<LoginHandshake> {
  const oidc = await getOidcConfig()

  const codeVerifier = client.randomPKCECodeVerifier()
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier)
  // Sent even where PKCE alone would do, because it is also what correlates the callback
  // with its stored handshake row.
  const state = client.randomState()
  // Checked against the id token on the way back. PKCE and the single-use state already cover
  // the code, so this is what covers the token: one obtained through a different handshake no
  // longer satisfies this one.
  const nonce = client.randomNonce()

  const url = client.buildAuthorizationUrl(oidc, {
    redirect_uri: config.oidc.redirectUri,
    scope: config.oidc.scopes,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  })

  return { url: url.href, state, codeVerifier, nonce }
}

/**
 * Finishes a login by exchanging the authorization code for tokens and reading the identity
 * out of the id token.
 * @param {URL} currentUrl - Callback url exactly as the browser requested it
 * @param {string} codeVerifier - PKCE verifier stored when the login began
 * @param {string} expectedState - State stored when the login began
 * @param {string} expectedNonce - Nonce stored when the login began
 * @returns {Promise<CompletedLogin>} - Identity the issuer vouched for, and the token it vouched with
 */
export async function completeLogin(
  currentUrl: URL,
  codeVerifier: string,
  expectedState: string,
  expectedNonce: string,
): Promise<CompletedLogin> {
  const oidc = await getOidcConfig()

  const tokens = await client.authorizationCodeGrant(oidc, currentUrl, {
    pkceCodeVerifier: codeVerifier,
    expectedState,
    expectedNonce,
  })

  const claims = tokens.claims()
  if (!claims) {
    throw new Error('id token carried no claims')
  }

  return {
    claims: {
      issuer: claims.iss,
      subject: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : null,
      name: typeof claims.name === 'string' ? claims.name : null,
      picture: typeof claims.picture === 'string' ? claims.picture : null,
      groups: Array.isArray(claims.groups)
        ? claims.groups.filter((entry): entry is string => typeof entry === 'string')
        : [],
    },
    idToken: tokens.id_token,
  }
}

/**
 * Builds the issuer's logout url, so ending the local session can end the issuer's too.
 *
 * The hint is what decides where the browser comes to rest. Without one an issuer has no
 * session to tie the request to, so it stops on a confirmation page of its own and drops the
 * return address; with one it ends the session and sends the browser back to the portal, which
 * is a login screen by then. `client_id` the library appends itself.
 *
 * The two travel together or not at all: RP-initiated logout lets an issuer refuse a return
 * address that arrives without a hint, and authentik does, so sending one alone turns a logout
 * that merely stopped early into `invalid_request`. A session opened before the id token was
 * stored has none, which is the case that reaches this.
 * @param {string} postLogoutRedirect - Absolute url to return to afterwards
 * @param {string | undefined} idToken - Token the session was opened with, when it kept one
 * @returns {Promise<string | undefined>} - Logout url, or undefined when the issuer advertises none
 */
export async function logoutUrl(
  postLogoutRedirect: string,
  idToken?: string,
): Promise<string | undefined> {
  const oidc = await getOidcConfig()
  if (!oidc.serverMetadata().end_session_endpoint) {
    return undefined
  }

  return client.buildEndSessionUrl(
    oidc,
    idToken ? { id_token_hint: idToken, post_logout_redirect_uri: postLogoutRedirect } : {},
  ).href
}
