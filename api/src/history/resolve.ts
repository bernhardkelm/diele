import { Resolver as DnsResolver } from 'node:dns/promises'
import { isIP } from 'node:net'
import { classifyAddress } from './addresses.js'

/** Resolves a name to every address it has. */
export type Resolver = (hostname: string) => Promise<ReadonlyArray<string>>

/** How long the first try waits for a nameserver, in ms; c-ares doubles it for the second. */
const TRY_TIMEOUT_MS = 750

/** Tries per nameserver before a lookup gives up. */
const TRIES = 2

let resolver: DnsResolver | undefined

/**
 * Hands out the one resolver every history lookup shares, created on first use. It is c-ares, which
 * asks the nameservers over its own sockets on the event loop: a stalled answer holds no libuv
 * thread, unlike `dns.lookup`, so it cannot starve sign-in hashing, the file system or any other
 * lookup. It reads the nameservers but not the hosts file.
 * @returns {DnsResolver} - The shared resolver
 */
function sharedResolver(): DnsResolver {
  resolver ??= new DnsResolver({ timeout: TRY_TIMEOUT_MS, tries: TRIES })
  return resolver
}

/**
 * Resolves a name's A and AAAA records together, ipv4 first, so a host without ipv6 routing tries
 * the address it can reach. A family that has no records, or fails, contributes nothing.
 * @param {string} hostname - Name to resolve
 * @returns {Promise<ReadonlyArray<string>>} - Every address found, empty when none was
 */
export async function resolveAll(hostname: string): Promise<ReadonlyArray<string>> {
  const dns = sharedResolver()
  const answers = await Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)])

  return answers.flatMap((answer) => (answer.status === 'fulfilled' ? answer.value : []))
}

/**
 * Reads the address an ip literal host names, without resolving anything.
 * @param {string} hostname - Host as the URL parser gives it, trailing dot removed
 * @returns {string | undefined} - The address without brackets, or undefined for a name
 */
export function literalAddress(hostname: string): string | undefined {
  const bare = hostname.replace(/^\[|\]$/g, '')

  return isIP(bare) === 0 ? undefined : bare
}

/**
 * Picks the address a probe may be pinned to: the first of a resolution in which every address
 * is public. One private, loopback, link-local or reserved address among them, or none at all,
 * means nothing is requested.
 * @param {ReadonlyArray<string> | undefined} addresses - What a name resolved to, undefined when it did not
 * @returns {string | undefined} - The address to connect to, or undefined when none may be
 */
export function publicAddress(addresses: ReadonlyArray<string> | undefined): string | undefined {
  if (!addresses || addresses.length === 0) {
    return undefined
  }

  return addresses.every((address) => classifyAddress(address) === 'public')
    ? addresses[0]
    : undefined
}
