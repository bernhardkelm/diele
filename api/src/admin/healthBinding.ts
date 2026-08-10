import { moduleFor } from '#connectors/registry.js'
import { listEnabledConnectors } from '#connectors/repository.js'
import type { HealthReading } from '#connectors/types.js'
import { badRequest } from '#errors.js'
import { HTTP_PROVIDER, parseProvider, providerValue } from '#health/providers.js'
import { clearBinding, readBinding, writeBinding } from '#health/repository.js'
import { HEALTH_KEY, MAX_SELECTOR_LENGTH, selectorField } from './healthSelector.js'

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
