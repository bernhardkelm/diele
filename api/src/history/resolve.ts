import { lookup } from 'node:dns/promises'
import {
  type AddressClass,
  classifyAddress,
  classifyHostname,
  strictestClass,
} from './addresses.js'

/** Resolves a name to every address it has. */
export type Resolver = (hostname: string) => Promise<ReadonlyArray<string>>

/**
 * Resolves a name the way a connection would, through the system resolver.
 * @param {string} hostname - Name to resolve
 * @returns {Promise<ReadonlyArray<string>>} - Every address it resolved to
 */
export async function lookupAll(hostname: string): Promise<ReadonlyArray<string>> {
  const addresses = await lookup(hostname, { all: true, verbatim: true })

  return addresses.map((entry) => entry.address)
}

/**
 * Decides where a host leads. A name is resolved, so `127.0.0.1.nip.io` and its kind are judged on
 * where they point rather than on how they are spelled, and a name with several addresses counts
 * as the most sensitive of them.
 * @param {string} hostname - Host, trailing dot removed
 * @param {Resolver} resolve - How a name is resolved
 * @returns {Promise<AddressClass | undefined>} - Where it leads, or undefined when it does not resolve
 */
export async function classifyHost(
  hostname: string,
  resolve: Resolver = lookupAll,
): Promise<AddressClass | undefined> {
  const byName = classifyHostname(hostname)
  if (byName) {
    return byName
  }

  try {
    const addresses = await resolve(hostname)

    return addresses.length > 0 ? strictestClass(addresses.map(classifyAddress)) : undefined
  } catch {
    return undefined
  }
}
