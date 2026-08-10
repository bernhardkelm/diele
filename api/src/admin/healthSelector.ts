import type { ApiFieldSpec } from '@diele/common'
import { moduleFor } from '#connectors/registry.js'
import { HTTP_SELECTOR_FIELD } from '#health/httpProbe.js'
import { HTTP_PROVIDER } from '#health/providers.js'

/** The field the dropdown is stored under, and what every selector's `showWhen` points at. */
export const HEALTH_KEY = 'health'

/** PromQL is the longest thing anyone binds with, and it is still not this long. */
export const MAX_SELECTOR_LENGTH = 500

/**
 * Returns the field a provider identifies its targets with, or undefined for one that needs
 * nothing beyond the entry's own url.
 * @param {string} provider - `http`, or a connector type
 * @returns {ApiFieldSpec | undefined} - The selector field the provider declares
 */
export function selectorField(provider: string): ApiFieldSpec | undefined {
  return provider === HTTP_PROVIDER ? HTTP_SELECTOR_FIELD : moduleFor(provider)?.healthSelectorField
}
