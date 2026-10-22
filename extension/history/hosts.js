// The server's address classes for a host given by name or literal, the part of them a browser
// can decide without resolving anything. Every name below has already been through the URL
// parser, which writes ipv4 in dotted decimal however it was typed (`0x7f.1`, `2130706433`) and
// ipv6 in its compressed lowercase form, with an embedded ipv4 address turned into two hex groups.

const DOTTED_IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

// Cloud metadata services that answer by name, whatever they resolve to
const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata'])

/**
 * Reads the four octets of a dotted ipv4 address.
 * @param {string} text - Address as the URL parser writes it
 * @returns {number[] | undefined} - The octets, or undefined when it is not one
 */
function ipv4Octets(text) {
  const match = DOTTED_IPV4.exec(text)
  if (!match) {
    return undefined
  }

  const octets = match.slice(1).map(Number)
  return octets.every((octet) => octet <= 255) ? octets : undefined
}

/**
 * Expands an ipv6 address into its eight groups, a trailing dotted ipv4 part included in case
 * one arrives unparsed.
 * @param {string} text - Address without brackets
 * @returns {number[] | undefined} - The groups, or undefined when it is not one
 */
function ipv6Groups(text) {
  if (!text.includes(':')) {
    return undefined
  }

  let address = text.toLowerCase().replace(/%.*$/, '')
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(address)?.[1]

  if (dotted) {
    const octets = ipv4Octets(dotted)
    if (!octets) {
      return undefined
    }

    const high = ((octets[0] << 8) | octets[1]).toString(16)
    const low = ((octets[2] << 8) | octets[3]).toString(16)
    address = `${address.slice(0, -dotted.length)}${high}:${low}`
  }

  const halves = address.split('::')
  if (halves.length > 2) {
    return undefined
  }

  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length

  if (missing < 0 || (halves.length === 1 && missing !== 0)) {
    return undefined
  }

  const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right]
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) {
    return undefined
  }

  return groups.map((group) => Number.parseInt(group, 16))
}

/**
 * Reads the ipv4 address an ipv6 one stands for, in the forms the server treats as that host:
 * mapped `::ffff:a.b.c.d`, translated `::ffff:0:a.b.c.d`, the deprecated compatible `::a.b.c.d`
 * and the NAT64 prefix `64:ff9b::/96`.
 * @param {number[]} groups - The eight groups of an ipv6 address
 * @returns {number[] | undefined} - The embedded octets, or undefined when there are none
 */
function embeddedIpv4Octets(groups) {
  const zero = (from, to) => groups.slice(from, to).every((group) => group === 0)

  const mapped = zero(0, 5) && groups[5] === 0xffff
  const translated = zero(0, 4) && groups[4] === 0xffff && groups[5] === 0
  const compatible = zero(0, 6)
  const nat64 = groups[0] === 0x64 && groups[1] === 0xff9b && zero(2, 6)

  if (!mapped && !translated && !compatible && !nat64) {
    return undefined
  }

  return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff]
}

// Ranges as [address, prefix length], checked in the server's order: loopback, link-local and
// metadata, private networks, then the rest of the IANA special-purpose registries, which are
// protocol assignments, documentation, the 6to4 relay, benchmarking, multicast and the reserved
// block with the broadcast address in it
const IPV4_LOOPBACK = [
  ['127.0.0.0', 8],
  ['0.0.0.0', 8],
]
const IPV4_LINK_LOCAL = [
  ['169.254.0.0', 16],
  ['100.100.100.200', 32],
]
const IPV4_PRIVATE = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['100.64.0.0', 10],
]
const IPV4_RESERVED = [
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

const IPV6_LOOPBACK = [
  ['::1', 128],
  ['::', 128],
]
const IPV6_LINK_LOCAL = [
  ['fe80::', 10],
  ['fd00:ec2::254', 128],
]
const IPV6_PRIVATE = [['fc00::', 7]]
const IPV6_GLOBAL_UNICAST = [['2000::', 3]]

// Inside global unicast but not one host anyone opens: the IETF protocol block, documentation in
// both its forms, and 6to4, whose embedded ipv4 address could be any of the ranges above
const IPV6_RESERVED = [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
]

/**
 * Returns whether the leading bits of two addresses agree, both given as numbers of the same
 * width each.
 * @param {number[]} address - The address, as octets or as groups
 * @param {number[]} network - The range's address in the same form
 * @param {number} prefix - How many leading bits must agree
 * @param {number} width - Bits per number, 8 for octets and 16 for groups
 * @returns {boolean} - True when the address lies in the range
 */
function inAddressRange(address, network, prefix, width) {
  for (let index = 0, left = prefix; left > 0; index += 1, left -= width) {
    const bits = Math.min(width, left)
    const mask = ((1 << bits) - 1) << (width - bits)

    if ((address[index] & mask) !== (network[index] & mask)) {
      return false
    }
  }

  return true
}

/**
 * Returns whether an ipv4 address lies in any of the ranges.
 * @param {number[]} octets - The four octets
 * @param {Array<[string, number]>} ranges - Ranges as [address, prefix length]
 * @returns {boolean} - True when one range holds it
 */
function inIpv4Ranges(octets, ranges) {
  return ranges.some(([network, prefix]) => inAddressRange(octets, ipv4Octets(network), prefix, 8))
}

/**
 * Returns whether an ipv6 address lies in any of the ranges.
 * @param {number[]} groups - The eight groups
 * @param {Array<[string, number]>} ranges - Ranges as [address, prefix length]
 * @returns {boolean} - True when one range holds it
 */
function inIpv6Ranges(groups, ranges) {
  return ranges.some(([network, prefix]) => inAddressRange(groups, ipv6Groups(network), prefix, 16))
}

/**
 * Classifies an ipv4 address the way the server does.
 * @param {number[]} octets - The four octets
 * @returns {'loopback' | 'linkLocal' | 'reserved' | 'private' | 'public'} - Where it leads
 */
function classifyIpv4(octets) {
  if (inIpv4Ranges(octets, IPV4_LOOPBACK)) {
    return 'loopback'
  }

  if (inIpv4Ranges(octets, IPV4_LINK_LOCAL)) {
    return 'linkLocal'
  }

  if (inIpv4Ranges(octets, IPV4_PRIVATE)) {
    return 'private'
  }

  return inIpv4Ranges(octets, IPV4_RESERVED) ? 'reserved' : 'public'
}

/**
 * Classifies an ipv6 address that embeds no ipv4 one the way the server does: public only inside
 * global unicast and outside its special-purpose blocks, reserved wherever else it is neither
 * private nor link-local.
 * @param {number[]} groups - The eight groups
 * @returns {'loopback' | 'linkLocal' | 'reserved' | 'private' | 'public'} - Where it leads
 */
function classifyIpv6(groups) {
  if (inIpv6Ranges(groups, IPV6_LOOPBACK)) {
    return 'loopback'
  }

  if (inIpv6Ranges(groups, IPV6_LINK_LOCAL)) {
    return 'linkLocal'
  }

  if (inIpv6Ranges(groups, IPV6_PRIVATE)) {
    return 'private'
  }

  const global = inIpv6Ranges(groups, IPV6_GLOBAL_UNICAST) && !inIpv6Ranges(groups, IPV6_RESERVED)

  return global ? 'public' : 'reserved'
}

/**
 * Classifies a host by its name alone: `localhost` and anything below it, a metadata service by
 * name, and ip literals, an ipv6 form that reaches an ipv4 host judged as that host.
 * @param {string} hostname - Host as the URL parser gives it, trailing dot removed
 * @returns {'loopback' | 'linkLocal' | 'reserved' | 'private' | 'public' | undefined} - Where it
 *   leads, or undefined when only resolving the name could say
 */
function classifyHistoryHost(hostname) {
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    return 'loopback'
  }

  if (METADATA_HOSTS.has(hostname)) {
    return 'linkLocal'
  }

  const octets = ipv4Octets(hostname)
  if (octets) {
    return classifyIpv4(octets)
  }

  const groups = ipv6Groups(hostname.replace(/^\[|\]$/g, ''))
  if (!groups) {
    return undefined
  }

  const embedded = embeddedIpv4Octets(groups)
  return embedded ? classifyIpv4(embedded) : classifyIpv6(groups)
}

/**
 * Returns whether a host is one the server drops by its name alone: loopback, link-local and
 * metadata, and every other special-purpose address. A private network is kept, as there.
 * @param {string} hostname - Host as the URL parser gives it, trailing dot removed
 * @returns {boolean} - True for a host never recorded
 */
function isUnreachableHost(hostname) {
  const address = classifyHistoryHost(hostname)
  return address === 'loopback' || address === 'linkLocal' || address === 'reserved'
}
