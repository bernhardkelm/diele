import type { ApiFieldOption, ApiFieldSpec } from '@diele/common'
import { config } from '#config.js'
import { messageOf, redactSecrets } from '#connectors/redact.js'
import { moduleFor, listModules } from '#connectors/registry.js'
import {
  listEnabledConnectors,
  recordHealthRead,
  type ConnectorRecord,
} from '#connectors/repository.js'
import type { ConnectorModule, HealthReading } from '#connectors/types.js'
import { badRequest } from '#errors.js'
import { readSecrets } from '#secrets/repository.js'
import { HTTP_SELECTOR_FIELD } from '#health/httpProbe.js'
import { HTTP_PROVIDER, parseProvider, providerValue } from '#health/providers.js'
import { clearBinding, readBinding, writeBinding } from '#health/repository.js'
import { isEnabled } from '#settings/toggles.js'

/** The field the dropdown is stored under, and what every selector's `showWhen` points at. */
const HEALTH_KEY = 'health'

/** PromQL is the longest thing anyone binds with, and it is still not this long. */
const MAX_SELECTOR_LENGTH = 500

// Short, because this sits in front of the admin panel painting. A source that is slower than
// this falls back to the typed box rather than holding the form.
const TARGETS_TIMEOUT_MS = 5_000

/** Kept first, so the dropdown still offers what a blank box used to mean. */
const AUTOMATIC: ApiFieldOption = { value: '', label: 'match automatically' }

/**
 * Asks one instance what it can be bound to, for a source that can say.
 *
 * A failure is not raised: this runs while the panel is being painted, and an instance that is
 * unreachable for a moment should cost its dropdown, not the whole form.
 * @param {ConnectorModule} module - Module the instance belongs to
 * @param {ConnectorRecord} instance - Instance to ask
 * @returns {Promise<ReadonlyArray<ApiFieldOption> | undefined>} - Its targets, or undefined
 */
async function targetsOf(
  module: ConnectorModule,
  instance: ConnectorRecord,
): Promise<ReadonlyArray<ApiFieldOption> | undefined> {
  if (!module.listHealthTargets) {
    return undefined
  }

  if (!config.secrets.available && module.secretKeys.length > 0) {
    return undefined
  }

  try {
    return await module.listHealthTargets({
      id: instance.id,
      label: instance.label,
      config: instance.config,
      secrets: readSecrets(instance.id),
      signal: AbortSignal.timeout(TARGETS_TIMEOUT_MS),
      cursor: null,
    })
  } catch (cause) {
    const error = redactSecrets(messageOf(cause), readSecrets(instance.id))

    // Recorded on the row as well as logged. Nothing else reaches a decorator that has yet to be
    // bound to anything, so without this a connector pointed at an address that does not answer
    // reads as merely unused until someone binds an entry to find out.
    recordHealthRead(instance.id, error)

    // Named, because the form silently degrading to a typed box looks like it never offered one
    console.warn(
      `[health] ${module.type}/${instance.label} could not list what it monitors:`,
      error,
    )

    return undefined
  }
}

/**
 * Returns the field a provider identifies its targets with, or undefined for one that needs
 * nothing beyond the entry's own url.
 * @param {string} provider - `http`, or a connector type
 * @returns {ApiFieldSpec | undefined} - The selector field the provider declares
 */
function selectorField(provider: string): ApiFieldSpec | undefined {
  return provider === HTTP_PROVIDER ? HTTP_SELECTOR_FIELD : moduleFor(provider)?.healthSelectorField
}

/**
 * Builds the liveness fields an entry carries: which provider answers for it, and whatever that
 * provider needs to recognise it.
 *
 * Both are assembled per request rather than declared once, because the choices are the
 * decorators someone has actually configured. A decorator this build knows but no instance of is
 * offered disabled instead of left out: the difference between "there is no such thing" and
 * "it is not set up yet" is exactly what an admin panel is for.
 * A source that can list what it monitors gets a selector of its own per instance, holding that
 * instance's targets: two Kumas watch different things, so one dropdown for the pair would offer
 * names half of it has never heard of.
 * @returns {Promise<ReadonlyArray<ApiFieldSpec>>} - The select, then the selectors
 */
export async function healthFields(): Promise<ReadonlyArray<ApiFieldSpec>> {
  const options: ApiFieldOption[] = [
    { value: '', label: 'off' },
    { value: HTTP_PROVIDER, label: 'HTTP probe' },
  ]

  const selectors: ApiFieldSpec[] = [
    { ...HTTP_SELECTOR_FIELD, showWhen: { key: HEALTH_KEY, value: [HTTP_PROVIDER] } },
  ]

  for (const module of listModules()) {
    if (!module.resolveHealth) {
      continue
    }

    const instances = isEnabled(module.type) ? listEnabledConnectors(module.type) : []

    if (instances.length === 0) {
      options.push({
        value: module.type,
        label: `${module.label} (not configured)`,
        disabled: true,
      })
      continue
    }

    const values = instances.map((instance) => providerValue(module.type, instance.id))

    instances.forEach((instance, index) => {
      options.push({ value: values[index] as string, label: `${module.label} · ${instance.label}` })
    })

    const field = module.healthSelectorField
    if (!field) {
      continue
    }

    const listed = await Promise.all(instances.map((instance) => targetsOf(module, instance)))

    // Instances that could not say, which keep the typed box between them
    const typed = values.filter((_value, index) => !listed[index])

    listed.forEach((targets, index) => {
      if (!targets) {
        return
      }

      selectors.push({
        ...field,
        input: 'select',
        // Required means there is no automatic fallback to offer, so the list stands alone
        options: field.required ? targets : [AUTOMATIC, ...targets],
        showWhen: { key: HEALTH_KEY, value: [values[index]] },
      })
    })

    if (typed.length > 0) {
      selectors.push({ ...field, showWhen: { key: HEALTH_KEY, value: typed } })
    }
  }

  return [
    {
      key: HEALTH_KEY,
      label: 'Liveness',
      input: 'select',
      options,
      hint: 'what the dot on this entry reports; one source per entry',
    },
    ...selectors,
  ]
}

/**
 * Adds the stored binding onto an admin row, so the form opens showing what is bound rather than
 * blank, and the list can draw the same dot the portal does. Read here rather than in the links
 * repository: a binding is a decorator's business, not a column on the row it decorates.
 * @param {T} row - Admin row carrying its ref
 * @param {HealthReading | undefined} reading - How it last answered, when that is already known
 * @returns {T & Record<string, unknown>} - The row with its liveness fields
 */
export function decorateRow<T extends { ref: string }>(
  row: T,
  reading?: HealthReading,
): T & Record<string, unknown> {
  const binding = readBinding(row.ref)
  const healthReading = binding ? (reading ?? null) : null

  if (!binding) {
    return { ...row, [HEALTH_KEY]: null, healthReading }
  }

  const key = selectorField(binding.provider)?.key

  return {
    ...row,
    [HEALTH_KEY]: providerValue(binding.provider, binding.connectorId),
    ...(key ? { [key]: binding.selector } : {}),
    healthReading,
  }
}

/**
 * Stores or clears the binding a create or update carried. A body that says nothing about
 * liveness leaves the binding alone, the way every other absent field is left alone.
 * @param {string} ref - Entry being bound
 * @param {unknown} body - Request body as it arrived
 * @returns {void}
 */
export function applyBinding(ref: string, body: unknown): void {
  if (body === null || typeof body !== 'object' || !(HEALTH_KEY in body)) {
    return
  }

  const source = body as Record<string, unknown>
  const parsed = parseProvider(source[HEALTH_KEY])

  if (!parsed) {
    clearBinding(ref)
    return
  }

  const { provider, connectorId } = parsed

  if (provider !== HTTP_PROVIDER) {
    const module = moduleFor(provider)
    if (!module?.resolveHealth) {
      throw badRequest(`"${provider}" reports no liveness`)
    }

    const found = listEnabledConnectors(provider).some((entry) => entry.id === connectorId)
    if (!found) {
      throw badRequest(`${module.label} has no enabled instance with that id`)
    }
  }

  const field = selectorField(provider)
  const raw = field ? source[field.key] : undefined
  const selector = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null

  if (selector !== null && selector.length > MAX_SELECTOR_LENGTH) {
    throw badRequest(`${field?.label ?? 'selector'} is too long`)
  }

  if (field?.required && selector === null) {
    throw badRequest(`${field.label} is required`)
  }

  writeBinding({ ref, provider, connectorId, selector })
}
