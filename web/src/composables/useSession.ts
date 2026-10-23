import { ref, type Ref } from 'vue'
import { singleFlight } from '@/helpers/singleFlight'
import {
  AUTH_LOGIN_URL,
  AUTH_LOGOUT_ALL_URL,
  AUTH_LOGOUT_URL,
  AUTH_ME_URL,
  AUTH_PROVIDERS_URL,
  AUTH_SETUP_URL,
  authLoginUrl,
} from '@/config/api'
import { ROUTES } from '@/composables/routes'
import { useHashRoute } from '@/composables/useHashRoute'
import { apiMessage, readPayload } from '@/helpers/apiError'
import { refreshConnectorEntries, resetConnectorEntries } from '@/composables/useConnectorEntries'
import { resetHealth } from '@/composables/useHealth'
import { refreshHistory, resetHistory } from '@/composables/useHistory'
import { refreshPortalConfig, resetPortalConfig } from '@/composables/usePortalConfig'
import { resetSignals } from '@/composables/useSignals'
import { clearLapse, reportLapse, sessionLapsed } from '@/composables/sessionLapse'
import { resetLaunchHistory } from '@/features/portal/useLaunchHistory'
import { applyBrandAccent } from '@/helpers/brandAccent'
import { clearConfigCache } from '@/helpers/configCache'
import { clearEntriesCache } from '@/helpers/entriesCache'
import { readInjectedBrand } from '@/helpers/injectedRuntime'
import { DEFAULT_BRAND } from '@/helpers/portalConfig'
import type { ApiBrand, ApiProvider, ApiProviders, ApiUser } from '@diele/common'

export interface Credentials {
  username: string
  password: string
  remember: boolean
}

export interface SetupDetails {
  username: string
  password: string
  name: string
  token: string
}

export interface SessionSource {
  /** Carried by the public providers endpoint, so the login screen can be branded too */
  brand: Ref<ApiBrand>
  user: Ref<ApiUser | undefined>
  providers: Ref<ReadonlyArray<ApiProvider>>
  /** How this deployment authenticates, undefined until the providers endpoint has answered */
  mode: Ref<ApiProviders['mode'] | undefined>
  /** True while the portal holds no account yet and the gate should offer to create one */
  setupRequired: Ref<boolean>
  /**
   * Set by a view that wants the gate on screen rather than a sign-in of its own. The gate is
   * not a route, so App decides when to paint it, and a lapsed session behind a cached config
   * is not a case it would otherwise recognise.
   */
  reauth: Ref<boolean>
  /**
   * True once any read of the api answered 401, until `/api/auth/me` reads the session back as
   * live. The portal stays painted either way; this is what lets it say so.
   */
  lapsed: Readonly<Ref<boolean>>
  /** Sends the browser to the issuer, or surfaces the password form, depending on the mode */
  signIn: (remember?: boolean) => void
  /**
   * Signs back in after a lapse without dropping what is painted: straight to the issuer where
   * one can answer from its own session, the gate's form where a password is needed.
   */
  resume: () => void
  signInWithPassword: (credentials: Credentials) => Promise<void>
  completeSetup: (details: SetupDetails) => Promise<void>
  signOut: () => Promise<void>
  /** Ends every session the account has, this browser's included */
  signOutEverywhere: () => Promise<void>
  loadProviders: () => Promise<void>
}

// Read once, at module scope, which is before the app mounts and so before the first paint. The
// gate is the one screen with no cached configuration to start from, so without this it paints
// the built-in defaults and swaps them for the deployment's own when providers answers.
const injectedBrand = readInjectedBrand()

const user = ref<ApiUser | undefined>()
const providers = ref<ReadonlyArray<ApiProvider>>([])
const brand = ref<ApiBrand>(injectedBrand ?? DEFAULT_BRAND)
const mode = ref<ApiProviders['mode'] | undefined>()
const setupRequired = ref(false)
const reauth = ref(false)

// Coming back to the tab fires visibilitychange and focus together, and alt-tabbing fires them
// over and over. One read of who is signed in answers all of those, so a re-check inside this
// window of the last read is skipped rather than sent.
const RECHECK_MS = 10_000
let lastRead = Number.NEGATIVE_INFINITY

if (injectedBrand) {
  applyBrandAccent(injectedBrand)
}

/**
 * Drops everything read about this deployment and whoever was signed in, so the next reader
 * asks again. The sibling of `resetPortalConfig` and `resetConnectorEntries`: all three hold
 * state at module scope, which outlives any component that reads it.
 * @returns {void}
 */
export function resetSession(): void {
  user.value = undefined
  providers.value = []
  brand.value = injectedBrand ?? DEFAULT_BRAND
  mode.value = undefined
  setupRequired.value = false
  reauth.value = false
  lastRead = Number.NEGATIVE_INFINITY
  clearLapse()
  loadProviders.reset()
}

/**
 * Reads who is signed in, if anyone. The one read whose answer settles a lapse either way: a
 * 401 records one, and a session read back as live lets go of it.
 * @returns {Promise<void>}
 */
async function loadUser(): Promise<void> {
  lastRead = Date.now()

  try {
    const response = await fetch(AUTH_ME_URL, { headers: { accept: 'application/json' } })
    if (!response.ok) {
      reportLapse(response.status)
      user.value = undefined
      return
    }

    user.value = (await response.json()) as ApiUser
    clearLapse()
  } catch {
    // an unreachable API is indistinguishable from being signed out, and the cached config
    // stays on screen either way
    user.value = undefined
  }
}

/** Reads who is signed in once, however many listeners ask at the same moment. */
const readUser = singleFlight(loadUser)

/**
 * Reads who is signed in again, for a tab that has just come back into view: a session that
 * ended while it sat in the background is noticed the moment someone looks at it, rather than
 * at the next poll that happens to answer 401.
 *
 * A session found live again after a lapse, signed back into from another tab, also refetches
 * the config, the entries and the history, since the reads that answered 401 meanwhile are not
 * retried by anything else.
 * @returns {Promise<void>}
 */
export async function recheckSession(): Promise<void> {
  if (Date.now() - lastRead < RECHECK_MS) {
    return
  }

  const wasLapsed = sessionLapsed.value
  await readUser()

  if (wasLapsed && !sessionLapsed.value) {
    await Promise.all([refreshPortalConfig(), refreshConnectorEntries(), refreshHistory()])
  }
}

/**
 * Reads how this deployment signs people in.
 *
 * Deduped, because the answer decides what the gate renders and several components ask for it
 * at once on a cold start.
 * @returns {Promise<void>}
 */
const loadProviders = singleFlight(() => fetchProviders())

/**
 * Fetches the providers endpoint and stores what it said.
 * @returns {Promise<void>}
 */
async function fetchProviders(): Promise<void> {
  try {
    const response = await fetch(AUTH_PROVIDERS_URL, { headers: { accept: 'application/json' } })
    if (!response.ok) {
      return
    }

    const payload = (await response.json()) as ApiProviders
    providers.value = payload.providers
    mode.value = payload.mode
    setupRequired.value = payload.setupRequired === true

    if (payload.brand) {
      brand.value = payload.brand
      applyBrandAccent(payload.brand)
    }
  } catch {
    // the gate holds its placeholder until this answers, rather than guessing at a mode
  }
}

/**
 * Reads the message out of a failed response, falling back to something a person can act on.
 * @param {Response} response - The response that was not ok
 * @returns {Promise<string>} - Message to show
 */
async function errorFrom(response: Response): Promise<string> {
  const payload = await readPayload(response)

  return apiMessage(payload, `request failed (${response.status})`)
}

/**
 * Picks the session up after a credential post, so the app moves off the gate without a reload.
 *
 * Re-reading the user is also the check that the cookie survived: a browser that rejected it
 * leaves this anonymous despite the 200, which is otherwise a silent failure.
 * @returns {Promise<void>}
 */
async function adoptSession(): Promise<void> {
  await loadUser()

  if (!user.value) {
    throw new Error(
      'signed in, but the browser did not keep the session cookie. Check that PUBLIC_ORIGIN ' +
        'matches the address in the address bar, and SESSION_COOKIE_SECURE over plain http.',
    )
  }

  setupRequired.value = false
  reauth.value = false
  // Both, and in parallel: the session changed without the page reloading, so every request
  // that answered 401 a moment ago has to be retried, not only the config's.
  await Promise.all([refreshPortalConfig(), refreshConnectorEntries(), refreshHistory()])
}

/**
 * Tracks the signed-in identity and the actions that change it.
 * @returns {SessionSource} - Reactive session and its controls
 */
export function useSession(): SessionSource {
  const { go } = useHashRoute()

  void loadUser()

  /**
   * Starts a sign-in for the modes that leave the page to do it.
   *
   * Local mode has nowhere to go: the form is already in this app, so this drops the cached
   * config instead, which is what brings the gate back on screen.
   * @param {boolean} remember - Whether to ask for the longer session
   * @returns {void}
   */
  function signIn(remember = false): void {
    if (mode.value === 'local') {
      clearConfigCache()
      clearEntriesCache()
      resetPortalConfig()
      resetConnectorEntries()
      resetHealth()
      resetSignals()
      resetHistory()
      // the ranking is this browser's, so what one account opened must not rank for the next
      resetLaunchHistory()
      return
    }

    const here = window.location.pathname + window.location.search + window.location.hash
    window.location.assign(authLoginUrl(here, remember))
  }

  /**
   * Signs back in after a lapse, keeping the cached portal rather than clearing it the way the
   * local branch of `signIn` does.
   *
   * An issuer that still holds the browser's own session answers the redirect at once, so the
   * redirecting modes go straight there. A password cannot be had that way, so local mode, and a
   * mode not known yet, hand the screen to the gate instead.
   * @returns {void}
   */
  function resume(): void {
    if (mode.value === 'oidc' || mode.value === 'dev') {
      signIn()
      return
    }

    reauth.value = true
  }

  /**
   * Signs in with a username and password.
   * @param {Credentials} credentials - What was typed into the form
   * @returns {Promise<void>}
   */
  async function signInWithPassword(credentials: Credentials): Promise<void> {
    const response = await fetch(AUTH_LOGIN_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(credentials),
    })

    if (!response.ok) {
      throw new Error(await errorFrom(response))
    }

    await adoptSession()
  }

  /**
   * Creates the portal's first account and signs in as it.
   * @param {SetupDetails} details - What was typed into the setup form
   * @returns {Promise<void>}
   */
  async function completeSetup(details: SetupDetails): Promise<void> {
    const response = await fetch(AUTH_SETUP_URL, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        username: details.username,
        password: details.password,
        name: details.name || null,
        token: details.token,
      }),
    })

    if (!response.ok) {
      throw new Error(await errorFrom(response))
    }

    // Before adopting the session, not after: adopting it unmounts the gate this form lives
    // in, so anything left until then runs in a component that is already gone. A portal
    // nobody has configured has nothing to show on its front page, so it opens on the panel.
    go(ROUTES.admin)

    await adoptSession()
  }

  /**
   * Ends this browser's session.
   * @returns {Promise<void>}
   */
  async function signOut(): Promise<void> {
    await endSession(AUTH_LOGOUT_URL)
  }

  /**
   * Ends every session the account has, this browser's included. The way back from a device that
   * is signed in and no longer to hand, which nothing else revokes: a session is left alone by
   * every later login, so it lives out its idle window otherwise.
   * @returns {Promise<void>}
   */
  async function signOutEverywhere(): Promise<void> {
    await endSession(AUTH_LOGOUT_ALL_URL)
  }

  /**
   * Ends a session and drops everything cached under it, the configuration, the connector entries
   * and the readings, so the next visitor to this browser does not paint the last one's portal.
   * @param {string} url - Endpoint that destroys the session, or every session
   * @returns {Promise<void>}
   */
  async function endSession(url: string): Promise<void> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { accept: 'application/json' },
      })

      // Only the server can end the session and clear an httpOnly cookie. If it did not
      // answer, the session is still live, and clearing local state here would leave someone
      // believing they had signed out when they had not.
      if (!response.ok) {
        throw new Error(`logout responded ${response.status}`)
      }

      const payload = (await response.json()) as { logoutUrl?: string | null }

      clearConfigCache()
      clearEntriesCache()
      resetPortalConfig()
      resetConnectorEntries()
      resetHealth()
      resetSignals()
      resetHistory()
      // the ranking is this browser's, so what one account opened must not rank for the next
      resetLaunchHistory()
      user.value = undefined

      window.location.assign(payload.logoutUrl ?? '/')
    } catch (error) {
      console.error('[diele] sign out failed, the session is still open:', error)
    }
  }

  return {
    brand,
    user,
    providers,
    mode,
    setupRequired,
    reauth,
    lapsed: sessionLapsed,
    signIn,
    resume,
    signInWithPassword,
    completeSetup,
    signOut,
    signOutEverywhere,
    loadProviders,
  }
}
