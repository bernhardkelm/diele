import type { ApiFieldOption, ApiFieldSpec } from '@diele/common'
import { moduleFor, listModules } from '#connectors/registry.js'
import { listEnabledConnectors } from '#connectors/repository.js'
import type { HealthReading } from '#connectors/types.js'
import { badRequest } from '#errors.js'
import { HTTP_SELECTOR_FIELD } from '#health/httpProbe.js'
import { HTTP_PROVIDER, parseProvider, providerValue } from '#health/providers.js'
import { clearBinding, readBinding, writeBinding } from '#health/repository.js'
import { isEnabled } from '#settings/toggles.js'

/** The field the dropdown is stored under, and what every selector's `showWhen` points at. */
const HEALTH_KEY = 'health'

/** PromQL is the longest thing anyone binds with, and it is still not this long. */
const MAX_SELECTOR_LENGTH = 500

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
 * @returns {ReadonlyArray<ApiFieldSpec>} - The select, then one selector per provider kind
 */
export function healthFields(): ReadonlyArray<ApiFieldSpec> {
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

    if (module.healthSelectorField) {
      selectors.push({
        ...module.healthSelectorField,
        showWhen: { key: HEALTH_KEY, value: values },
      })
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
