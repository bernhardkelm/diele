import { ref, type Ref } from 'vue'
import { ADMIN_FEATURES_URL, adminFeatureEnabledUrl } from '@/config/api'
import { refreshConnectorEntries } from '@/composables/useConnectorEntries'
import { usePortalConfig } from '@/composables/usePortalConfig'
import { apiFieldMessage, readPayload } from '@/helpers/apiError'
import type { ApiFeature, ApiRow } from '@diele/common'

/** Carries the status so a lapsed session can be told apart from a rejected edit. */
class AdminError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'AdminError'
    this.status = status
  }
}

export interface AdminSource {
  features: Ref<ReadonlyArray<ApiFeature>>
  /** Rows of the expanded feature, keyed by nothing: only one is ever open */
  rows: Ref<ReadonlyArray<ApiRow>>
  expanded: Ref<string | undefined>
  error: Ref<string | undefined>
  /** True when the session lapsed, so the view offers signing in rather than an error */
  needsAuth: Ref<boolean>
  /** True when the account is signed in but may not configure, which signing in again cannot fix */
  forbidden: Ref<boolean>
  busy: Ref<boolean>
  /**
   * What the pending action is doing, for one that takes long enough to need saying. A write
   * that only touches this database answers before anything could be drawn; one that reaches a
   * connector's source waits on the network, and a form that just sits there reads as broken.
   */
  busyLabel: Ref<string | undefined>
  /** True while rows are being reloaded behind ones that are already on screen */
  refreshing: Ref<boolean>
  /**
   * Loads the registry, holding a failure rather than raising it. This is the first call the
   * view makes, so a lapsed session raised out of here would leave the panel empty with nothing
   * said; held, it offers signing in.
   */
  loadFeatures: () => Promise<void>
  /** Reloads the registry and the open feature's rows, after something replaced them wholesale */
  reload: () => Promise<boolean>
  expand: (featureId: string | undefined) => Promise<void>
  /**
   * Every write answers whether it went through, rather than only leaving a message behind. A
   * save now reaches the connector's own source and can be refused on what it finds there, and
   * the form has to stay open holding what was typed when that happens.
   */
  create: (values: Record<string, unknown>) => Promise<boolean>
  update: (id: number, values: Record<string, unknown>) => Promise<boolean>
  setEnabled: (id: number, enabled: boolean) => Promise<boolean>
  /** Turns a whole feature on or off, which is not the same as it having no rows */
  setFeatureEnabled: (featureId: string, enabled: boolean) => Promise<boolean>
  remove: (id: number) => Promise<boolean>
  move: (id: number, delta: number) => Promise<boolean>
  /** Refreshes one connector now, for a feature that fetches on a schedule */
  sync: (id: number) => Promise<boolean>
}

const features = ref<ReadonlyArray<ApiFeature>>([])
const rows = ref<ReadonlyArray<ApiRow>>([])
const expanded = ref<string | undefined>()
const error = ref<string | undefined>()
const needsAuth = ref(false)
const forbidden = ref(false)
const busy = ref(false)
const busyLabel = ref<string | undefined>()
const refreshing = ref(false)

// Rows of every feature opened this visit. Reopening one paints from here and revalidates
// behind it, because emptying the list first collapses the panel and drops everything below
// it up the page before the answer arrives.
const cached = new Map<string, ReadonlyArray<ApiRow>>()

/**
 * Drops everything the panel read, so the next reader asks again. The sibling of
 * `resetSession` and `resetPortalConfig`: all of this is held at module scope, which outlives
 * any component that reads it.
 * @returns {void}
 */
export function resetAdmin(): void {
  features.value = []
  rows.value = []
  expanded.value = undefined
  error.value = undefined
  needsAuth.value = false
  forbidden.value = false
  busy.value = false
  busyLabel.value = undefined
  refreshing.value = false
  cached.clear()
}

/**
 * Returns the collection url for a feature, or undefined when it owns no rows. The registry
 * carries it, so this file knows nothing about which endpoint belongs to which feature and a
 * new connector needs no entry here.
 * @param {string} featureId - Which feature's rows to address
 * @returns {string | undefined} - Same-origin collection url, or undefined when it has none
 */
function collectionUrl(featureId: string): string | undefined {
  return features.value.find((feature) => feature.id === featureId)?.collection
}

/**
 * Returns a feature's collection, refusing one that has none.
 * @param {string | undefined} featureId - Feature being written to
 * @returns {string} - Its collection url
 */
function collectionOf(featureId: string | undefined): string {
  const url = featureId ? collectionUrl(featureId) : undefined
  if (!url) {
    throw new AdminError(400, 'this feature has no entries to change')
  }

  return url
}

/**
 * Calls the admin API and raises the server's message, so a rejected edit says why rather
 * than failing silently.
 * @param {string} url - Endpoint to call
 * @param {RequestInit} init - Fetch options
 * @returns {Promise<unknown>} - Parsed response body
 */
async function call(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  })

  const payload = await readPayload(response)

  if (!response.ok) {
    // the field path, because an admin form submits several at once and the message alone
    // would not say which of them the server refused
    throw new AdminError(
      response.status,
      apiFieldMessage(payload, `request failed (${response.status})`),
    )
  }

  return payload
}

/**
 * Reloads the expanded feature's rows.
 * @returns {Promise<void>}
 */
async function reloadRows(): Promise<void> {
  const id = expanded.value
  if (!id) {
    rows.value = []
    return
  }

  const feature = features.value.find((entry) => entry.id === id)
  const url = collectionUrl(id)

  if (feature?.unavailable || !url) {
    cached.delete(id)
    rows.value = []
    return
  }

  const payload = (await call(url)) as { rows?: ApiRow[] }
  const next = payload.rows ?? []

  // The feature may have been closed, or another opened, while this was in flight; writing
  // then would paint one feature's rows under another's name.
  cached.set(id, next)

  if (expanded.value === id) {
    rows.value = next
  }
}

/**
 * Reloads the feature registry and its counts.
 * @returns {Promise<void>}
 */
async function loadFeatures(): Promise<void> {
  const payload = (await call(ADMIN_FEATURES_URL)) as { features?: ApiFeature[] }
  features.value = payload.features ?? []
}

/**
 * Runs an admin action, holding the error it raises so the view can show it, and refreshing
 * the rows, the registry counts and everything the portal itself paints from afterwards.
 *
 * The connector entries are refreshed alongside the configuration, and on every action rather
 * than only the obvious ones: adding a connector, editing one, turning one off and deleting one
 * all change what the front page carries, and going back to a page still showing the old rows
 * reads as the edit not having worked.
 * @param {() => Promise<unknown>} action - The call to run
 * @param {string | undefined} label - What to say while it runs, for one that waits on a source
 * @returns {Promise<boolean>} - True when it went through, false when it was held as an error
 */
async function run(action: () => Promise<unknown>, label?: string): Promise<boolean> {
  busy.value = true
  busyLabel.value = label
  error.value = undefined

  try {
    await action()
    await loadFeatures()
    await reloadRows()
    await Promise.all([usePortalConfig().refresh(), refreshConnectorEntries()])

    // A run that got this far was answered, so whatever lapsed has since been fixed. Signing
    // in again is exactly that case, and without this the panel stays behind the login form
    // it just satisfied.
    needsAuth.value = false
    forbidden.value = false

    return true
  } catch (cause) {
    hold(cause)

    return false
  } finally {
    busy.value = false
    busyLabel.value = undefined
  }
}

/**
 * Returns what to say while a save runs, which is only worth saying for a save that reaches an
 * outside source: everything else answers before a word could be read.
 *
 * A liveness binding makes an ordinary row one of those, so the values decide as well as the
 * feature does - a card bound to a probe is checked on save the way a connector's token is.
 * @param {Record<string, unknown> | undefined} values - What the form is submitting
 * @returns {string | undefined} - The word, or undefined for a write that stays local
 */
function probeLabel(values?: Record<string, unknown>): string | undefined {
  const feature = features.value.find((entry) => entry.id === expanded.value)

  if (feature?.capabilities?.length) {
    return 'checking'
  }

  return values?.health ? 'checking' : undefined
}

/**
 * Returns what to say while a row action fetches. The same action word on both, since a
 * connector re-reads its source and a bound entry re-asks whether it is up.
 * @returns {string} - The word
 */
function syncLabel(): string {
  const feature = features.value.find((entry) => entry.id === expanded.value)

  return feature?.capabilities?.includes('entries') ? 'syncing' : 'probing'
}

/**
 * Records a failure, telling three cases apart: a lapsed session the view can offer to fix, an
 * account that may not configure at all, and a rejected edit that is something to read. The
 * middle one is not a lapse, so offering the sign-in form for it would only loop.
 * @param {unknown} cause - Error raised by a call
 * @returns {void}
 */
function hold(cause: unknown): void {
  if (cause instanceof AdminError && cause.status === 401) {
    needsAuth.value = true
    forbidden.value = false
    error.value = undefined
    return
  }

  if (cause instanceof AdminError && cause.status === 403) {
    forbidden.value = true
    needsAuth.value = false
    error.value = undefined
    return
  }

  needsAuth.value = false
  forbidden.value = false
  error.value = cause instanceof Error ? cause.message : String(cause)
}

/**
 * Exposes the admin view's data: what can be configured, the rows of whichever feature is
 * expanded, and the edits themselves.
 * @returns {AdminSource} - Reactive admin state and its controls
 */
export function useAdmin(): AdminSource {
  /**
   * Loads the registry the way the rest of this surface calls it, holding what it raises.
   * @returns {Promise<void>}
   */
  async function load(): Promise<void> {
    try {
      await loadFeatures()

      // A load that was answered says whatever lapsed has since been fixed, the way `run` does.
      // These outlive the view that read them, so signing in and coming back would otherwise
      // land on a panel still holding the refusal it was sent away for.
      needsAuth.value = false
      forbidden.value = false
    } catch (cause) {
      hold(cause)
    }
  }

  /**
   * Expands one feature, or collapses whatever is open when given nothing.
   * @param {string | undefined} featureId - Feature to expand
   * @returns {Promise<void>}
   */
  async function expand(featureId: string | undefined): Promise<void> {
    if (expanded.value === featureId) {
      return
    }

    expanded.value = featureId
    error.value = undefined
    needsAuth.value = false
    forbidden.value = false

    if (!featureId) {
      rows.value = []
      return
    }

    // Whatever this feature held last time, at once. An empty list only shows on the first
    // open of a feature, where there is genuinely nothing to show yet.
    rows.value = cached.get(featureId) ?? []

    refreshing.value = true
    try {
      if (features.value.length === 0) {
        await loadFeatures()
      }

      await reloadRows()
    } catch (cause) {
      hold(cause)
    } finally {
      refreshing.value = false
    }
  }

  return {
    features,
    rows,
    expanded,
    error,
    needsAuth,
    forbidden,
    busy,
    busyLabel,
    refreshing,
    loadFeatures: load,
    reload: () => run(() => Promise.resolve()),
    expand,
    create: (values) =>
      run(
        () => call(collectionOf(expanded.value), { method: 'POST', body: JSON.stringify(values) }),
        probeLabel(values),
      ),
    update: (id, values) =>
      run(
        () =>
          call(`${collectionOf(expanded.value)}/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(values),
          }),
        probeLabel(values),
      ),
    setFeatureEnabled: (featureId, enabled) =>
      run(() =>
        call(adminFeatureEnabledUrl(featureId), {
          method: 'PUT',
          body: JSON.stringify({ enabled }),
        }),
      ),
    setEnabled: (id, enabled) =>
      run(() =>
        call(`${collectionOf(expanded.value)}/${id}/enabled`, {
          method: 'PUT',
          body: JSON.stringify({ enabled }),
        }),
      ),
    remove: (id) => run(() => call(`${collectionOf(expanded.value)}/${id}`, { method: 'DELETE' })),
    sync: (id) =>
      run(
        () => call(`${collectionOf(expanded.value)}/${id}/sync`, { method: 'POST' }),
        syncLabel(),
      ),
    move: (id, delta) =>
      run(() => {
        const current = rows.value.map((row) => row.id)
        const from = current.indexOf(id)
        const to = from + delta
        if (from < 0 || to < 0 || to >= current.length) {
          return Promise.resolve()
        }

        const next = [...current]
        next.splice(to, 0, ...next.splice(from, 1))

        return call(`${collectionOf(expanded.value)}/order`, {
          method: 'PUT',
          body: JSON.stringify({ ids: next }),
        })
      }),
  }
}
