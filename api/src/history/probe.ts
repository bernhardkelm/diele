import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { LookupFunction } from 'node:net'
import { type AddressClass, classifyAddress, classifyHostname } from './addresses.js'

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
 * Builds a resolver for the connection itself that refuses an address the policy does not allow.
 * The check sits at connect time because that is the resolution the request actually uses: one
 * made earlier can be answered differently a moment later, which is all a rebinding attack is.
 * @param {AddressPolicy} allow - Which addresses may be reached
 * @returns {LookupFunction} - A `lookup` for `http.request`
 */
export function guardedLookup(allow: AddressPolicy): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
      if (error) {
        callback(error, '', 0)
        return
      }

      const allowed =
        addresses.length > 0 && addresses.every((entry) => allow(classifyAddress(entry.address)))
      const first = addresses[0]

      if (!allowed || !first) {
        callback(new Error('address refused'), '', 0)
        return
      }

      if (options.all) {
        callback(null, addresses)
        return
      }

      callback(null, first.address, first.family)
    })
  }
}

/**
 * Sends one request and reads its status, following nothing.
 * @param {URL} target - Page to ask about
 * @param {'HEAD' | 'GET'} method - How to ask
 * @param {AddressPolicy} allow - Which addresses may be reached
 * @returns {Promise<number>} - The status it answered with
 */
function statusOf(target: URL, method: 'HEAD' | 'GET', allow: AddressPolicy): Promise<number> {
  const request = target.protocol === 'https:' ? httpsRequest : httpRequest

  return new Promise<number>((resolve, reject) => {
    const outgoing = request(
      target,
      {
        method,
        agent: false,
        lookup: guardedLookup(allow),
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
 * wall in front of a real page is the ordinary case. No answer at all, a refused connection, a
 * name that does not resolve, an address the policy refuses or a timeout, says it is not.
 *
 * HEAD first, since only the status is wanted, and GET where a server refuses HEAD. Errors are
 * swallowed and nothing is logged: the url is the visitor's, and a log line would keep it.
 * @param {string} url - Page to ask about, in stored form, so no query or credentials leave here
 * @param {AddressPolicy} allow - Which addresses may be reached
 * @returns {Promise<boolean>} - True when something answered for it
 */
export async function pageExists(url: string, allow: AddressPolicy = publicOnly): Promise<boolean> {
  try {
    const target = new URL(url)
    // An ip literal is never resolved, so the connect-time check never sees it.
    const byName = classifyHostname(target.hostname.replace(/\.+$/, ''))
    if (byName && !allow(byName)) {
      return false
    }

    let status = await statusOf(target, 'HEAD', allow)
    if (status === 405 || status === 501) {
      status = await statusOf(target, 'GET', allow)
    }

    return status !== 404 && status !== 410
  } catch {
    return false
  }
}
