import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP, type LookupFunction } from 'node:net'
import { type AddressClass, classifyAddress } from './addresses.js'
import { literalAddress } from './resolve.js'

/** Long enough for a service that is thinking, the same wait the liveness probe gives one. */
const PROBE_TIMEOUT_MS = 5_000

/** Which classes of address a probe may connect to. */
export type AddressPolicy = (address: AddressClass) => boolean

/**
 * Lets a probe reach public addresses only.
 * @param {AddressClass} address - Where the connection would lead
 * @returns {boolean} - True for a public address
 */
export const publicOnly: AddressPolicy = (address) => address === 'public'

/**
 * Builds a `lookup` for the connection that answers with an address already vetted and resolves
 * nothing. The socket then connects where the check said it may, whatever the name would answer a
 * moment later, which is all DNS rebinding is; and no `getaddrinfo` runs on libuv's thread pool.
 * @param {string} address - The vetted address, without brackets
 * @returns {LookupFunction} - A `lookup` for `http.request`
 */
export function pinnedLookup(address: string): LookupFunction {
  const family = isIP(address)

  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family }])
      return
    }

    callback(null, address, family)
  }
}

/**
 * Sends one request to the pinned address and reads its status, following nothing. The url keeps
 * its hostname, so the `Host` header and the TLS server name are the site's and virtual hosting
 * and certificate checks work as they would for a browser.
 * @param {URL} target - Page to ask about
 * @param {'HEAD' | 'GET'} method - How to ask
 * @param {string} address - Where to connect
 * @returns {Promise<number>} - The status it answered with
 */
function statusOf(target: URL, method: 'HEAD' | 'GET', address: string): Promise<number> {
  const secure = target.protocol === 'https:'
  const request = secure ? httpsRequest : httpRequest
  const hostname = target.hostname.replace(/\.+$/, '')
  const named = literalAddress(hostname) === undefined

  return new Promise<number>((resolve, reject) => {
    const outgoing = request(
      target,
      {
        method,
        agent: false,
        lookup: pinnedLookup(address),
        // An ip literal is no server name, and node warns when one is passed as such.
        ...(secure && named ? { servername: hostname } : {}),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        headers: { 'user-agent': 'diele', accept: '*/*' },
      },
      (incoming) => {
        resolve(incoming.statusCode ?? 0)
        // Nothing here reads the body, and leaving it open holds the socket.
        incoming.destroy()
      },
    )

    outgoing.once('error', reject)
    outgoing.end()
  })
}

/**
 * Asks whether a page exists, which is a looser question than whether it is up: any answer but
 * 404 and 410 says the address is real. A redirect, a 401 and a 403 all count, because a login
 * wall in front of a real page is the ordinary case. No answer at all, a refused connection, an
 * address the policy refuses or a timeout, says it is not.
 *
 * HEAD first, since only the status is wanted, and GET where a server refuses HEAD. Both go to
 * the address given, never to a second resolution. Errors are swallowed and nothing is logged:
 * the url is the visitor's, and a log line would keep it.
 * @param {string} url - Page to ask about, in stored form, so no query or credentials leave here
 * @param {string} address - The address the host was vetted at, which the request is pinned to
 * @param {AddressPolicy} allow - Which addresses may be reached
 * @returns {Promise<boolean>} - True when something answered for it
 */
export async function pageExists(
  url: string,
  address: string,
  allow: AddressPolicy = publicOnly,
): Promise<boolean> {
  try {
    const target = new URL(url)
    // A literal host is connected to as written, never through the lookup, so it is the address.
    const literal = literalAddress(target.hostname.replace(/\.+$/, ''))

    if (!allow(classifyAddress(address)) || (literal !== undefined && literal !== address)) {
      return false
    }

    let status = await statusOf(target, 'HEAD', address)
    if (status === 405 || status === 501) {
      status = await statusOf(target, 'GET', address)
    }

    return status !== 404 && status !== 410
  } catch {
    return false
  }
}
