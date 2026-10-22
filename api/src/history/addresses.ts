import { BlockList, isIP } from 'node:net'

/**
 * Where an address leads, as far as recording a visit to it goes:
 * - `loopback`: the visitor's own machine, dropped
 * - `linkLocal`: link-local and cloud metadata, dropped and never requested
 * - `reserved`: any other special-purpose address, documentation, multicast, 6to4 and the like,
 *   dropped and never requested
 * - `private`: a private, unique-local or carrier-grade NAT network, kept without a probe
 * - `public`: global unicast and nothing else, probed when probing is on
 */
export type AddressClass = 'loopback' | 'linkLocal' | 'reserved' | 'private' | 'public'

/** Hosts that are a metadata service by name, whatever they resolve to. */
const METADATA_HOSTS: ReadonlySet<string> = new Set(['metadata.google.internal', 'metadata'])

/**
 * Builds a block list from CIDR ranges.
 * @param {ReadonlyArray<string>} ranges - Ranges as `address/prefix`
 * @returns {BlockList} - The list
 */
function blocks(ranges: ReadonlyArray<string>): BlockList {
  const list = new BlockList()

  for (const range of ranges) {
    const [network = '', prefix = ''] = range.split('/')
    list.addSubnet(network, Number(prefix), isIP(network) === 4 ? 'ipv4' : 'ipv6')
  }

  return list
}

const loopback = blocks(['127.0.0.0/8', '0.0.0.0/8', '::1/128', '::/128'])

const linkLocal = blocks(['169.254.0.0/16', '100.100.100.200/32', 'fe80::/10', 'fd00:ec2::254/128'])

const privateRanges = blocks([
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '100.64.0.0/10',
  'fc00::/7',
])

// The rest of the IANA special-purpose registries: protocol assignments, documentation, the 6to4
// relay, benchmarking, multicast and the reserved block with the broadcast address in it.
const reservedIpv4 = blocks([
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
])

const globalUnicast = blocks(['2000::/3'])

// Inside 2000::/3 but not reachable as one host: the IETF protocol block (Teredo, ORCHID and the
// rest, none of them a page anyone opens), documentation in both its forms, and 6to4, whose
// embedded ipv4 address could be any of the ranges above.
const reservedIpv6 = blocks(['2001::/23', '2001:db8::/32', '2002::/16', '3fff::/20'])

/**
 * Expands an ipv6 address into its sixteen bytes.
 * @param {string} address - An ipv6 address, without brackets
 * @returns {number[] | undefined} - The bytes, or undefined when it is not one
 */
function ipv6Bytes(address: string): number[] | undefined {
  if (isIP(address) !== 6) {
    return undefined
  }

  let text = address.toLowerCase().replace(/%.*$/, '')
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)?.[1]

  if (dotted) {
    const [a = 0, b = 0, c = 0, d = 0] = dotted.split('.').map(Number)
    text = `${text.slice(0, -dotted.length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }

  const [head = '', tail] = text.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups = [
    ...left,
    ...Array.from({ length: 8 - left.length - right.length }, () => '0'),
    ...right,
  ]

  return groups.flatMap((group) => {
    const value = Number.parseInt(group, 16)
    return [value >> 8, value & 0xff]
  })
}

/**
 * Reads the ipv4 address an ipv6 one stands for, when it embeds one in a form that reaches the
 * ipv4 host: ipv4-mapped `::ffff:a.b.c.d`, ipv4-translated `::ffff:0:a.b.c.d`, the deprecated
 * ipv4-compatible `::a.b.c.d`, and the NAT64 well-known prefix `64:ff9b::/96`.
 * @param {string} address - An ipv6 address, without brackets
 * @returns {string | undefined} - The embedded ipv4 address, or undefined when there is none
 */
export function embeddedIpv4(address: string): string | undefined {
  const bytes = ipv6Bytes(address)
  if (!bytes) {
    return undefined
  }

  const zero = (from: number, to: number): boolean => bytes.slice(from, to).every((b) => b === 0)
  const is = (at: number, ...values: number[]): boolean =>
    values.every((value, index) => bytes[at + index] === value)

  const mapped = zero(0, 10) && is(10, 0xff, 0xff)
  const translated = zero(0, 8) && is(8, 0xff, 0xff) && zero(10, 12)
  const compatible = zero(0, 12)
  const nat64 = is(0, 0x00, 0x64, 0xff, 0x9b) && zero(4, 12)

  return mapped || translated || compatible || nat64 ? bytes.slice(12).join('.') : undefined
}

/**
 * Classifies an ipv4 address.
 * @param {string} address - Dotted ipv4 address
 * @returns {AddressClass} - Where it leads
 */
function classifyIpv4(address: string): AddressClass {
  if (loopback.check(address, 'ipv4')) {
    return 'loopback'
  }

  if (linkLocal.check(address, 'ipv4')) {
    return 'linkLocal'
  }

  if (privateRanges.check(address, 'ipv4')) {
    return 'private'
  }

  return reservedIpv4.check(address, 'ipv4') ? 'reserved' : 'public'
}

/**
 * Classifies an ipv6 address that embeds no ipv4 one. Public only inside global unicast and
 * outside its special-purpose blocks; anything else that is neither private nor link-local is
 * reserved.
 * @param {string} address - An ipv6 address, without brackets
 * @returns {AddressClass} - Where it leads
 */
function classifyIpv6(address: string): AddressClass {
  if (loopback.check(address, 'ipv6')) {
    return 'loopback'
  }

  if (linkLocal.check(address, 'ipv6')) {
    return 'linkLocal'
  }

  if (privateRanges.check(address, 'ipv6')) {
    return 'private'
  }

  const global = globalUnicast.check(address, 'ipv6') && !reservedIpv6.check(address, 'ipv6')

  return global ? 'public' : 'reserved'
}

/**
 * Classifies one resolved address. An ipv6 form that reaches an ipv4 host is judged as that host.
 * @param {string} address - An ipv4 or ipv6 address, ipv6 with or without brackets
 * @returns {AddressClass} - Where it leads; anything unreadable counts as loopback, the safe end
 */
export function classifyAddress(address: string): AddressClass {
  const bare = address.replace(/^\[|\]$/g, '')

  if (isIP(bare) === 4) {
    return classifyIpv4(bare)
  }

  if (isIP(bare) !== 6) {
    return 'loopback'
  }

  const mapped = embeddedIpv4(bare)

  return mapped ? classifyIpv4(mapped) : classifyIpv6(bare)
}

/**
 * Classifies a host by its name alone, for what is decided before anything is resolved: an ip
 * literal, a localhost name or a metadata service by name.
 * @param {string} hostname - Host as the URL parser gives it, trailing dot removed
 * @returns {AddressClass | undefined} - Where it leads, or undefined when only resolving can say
 */
export function classifyHostname(hostname: string): AddressClass | undefined {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return 'loopback'
  }

  if (METADATA_HOSTS.has(hostname)) {
    return 'linkLocal'
  }

  const bare = hostname.replace(/^\[|\]$/g, '')

  return isIP(bare) === 0 ? undefined : classifyAddress(bare)
}

/**
 * Returns whether a class is one that is dropped outright: never stored, never requested.
 * @param {AddressClass | undefined} address - Where a host leads
 * @returns {boolean} - True for loopback, link-local and reserved
 */
export function isUnreachable(address: AddressClass | undefined): boolean {
  return address === 'loopback' || address === 'linkLocal' || address === 'reserved'
}

/**
 * Ranks the classes from the one that must never be reached to the one that may be, so a name
 * resolving to several addresses is treated as its most sensitive one.
 * @param {ReadonlyArray<AddressClass>} classes - Classes of every address a name resolved to
 * @returns {AddressClass} - The most sensitive of them
 */
export function strictestClass(classes: ReadonlyArray<AddressClass>): AddressClass {
  const order: ReadonlyArray<AddressClass> = [
    'linkLocal',
    'loopback',
    'reserved',
    'private',
    'public',
  ]

  return order.find((candidate) => classes.includes(candidate)) ?? 'loopback'
}
