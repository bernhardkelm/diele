/**
 * How a binding names what answers for it. One value the admin form stores and the resolver
 * reads back, so the dropdown and the fan-out cannot disagree about what `uptime-kuma:3` means.
 *
 * The built-in probe has no instance behind it and is therefore the bare word; every decorator
 * is a type and the row it was configured on, because two Kuma instances are two answers.
 */

/** The built-in probe, which is not a connector: no source, no credential, no row. */
export const HTTP_PROVIDER = 'http'

export interface ProviderRef {
  readonly provider: string
  /** Null exactly for the built-in probe */
  readonly connectorId: number | null
}

/**
 * Builds the value a binding stores and the dropdown offers.
 * @param {string} provider - `http`, or a connector type
 * @param {number | null} connectorId - Instance the binding points at, null for the built-in probe
 * @returns {string} - Option value, e.g. `http` or `uptime-kuma:3`
 */
export function providerValue(provider: string, connectorId: number | null): string {
  return connectorId === null ? provider : `${provider}:${connectorId}`
}

/**
 * Reads an option value back. Anything unrecognised is undefined rather than a guess, so a value
 * left over from a connector that has since been removed unbinds instead of resolving elsewhere.
 * @param {unknown} value - Value as it arrived from the form or the row
 * @returns {ProviderRef | undefined} - The provider, or undefined when the value names none
 */
export function parseProvider(value: unknown): ProviderRef | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined
  }

  if (value === HTTP_PROVIDER) {
    return { provider: HTTP_PROVIDER, connectorId: null }
  }

  // rsplit: a connector type may hold a hyphen, and `uptime-kuma:3` must not split on the first
  const separator = value.lastIndexOf(':')
  if (separator <= 0) {
    return undefined
  }

  const id = Number(value.slice(separator + 1))
  if (!Number.isInteger(id) || id <= 0) {
    return undefined
  }

  return { provider: value.slice(0, separator), connectorId: id }
}
