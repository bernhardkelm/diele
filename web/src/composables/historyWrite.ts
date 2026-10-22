import { reportLapse } from '@/composables/sessionLapse'
import { isSameAccount, markWrite } from '@/composables/historyState'

/** How a write ended: taken, refused for a lapsed session, or refused or lost for any other reason */
export type WriteOutcome = 'done' | 'lapsed' | 'failed'

export interface HistoryWrite {
  readonly outcome: WriteOutcome
  /** The api's answer, for a write that was taken */
  readonly response?: Response
  /** Whether the account it was sent for is still signed in, so its answer may be adopted */
  readonly current: boolean
}

const JSON_HEADERS = { accept: 'application/json', 'content-type': 'application/json' }

/**
 * Sends one request to the history endpoints and reports how it ended, a lapsed session included.
 * @param {string} url - Endpoint to write to
 * @param {RequestInit} init - Method and body
 * @returns {Promise<Omit<HistoryWrite, 'current'>>} - How it ended, with the answer when it was taken
 */
export async function postHistory(
  url: string,
  init: RequestInit,
): Promise<Omit<HistoryWrite, 'current'>> {
  try {
    const response = await fetch(url, { headers: JSON_HEADERS, ...init })

    if (response.ok) {
      return { outcome: 'done', response }
    }

    console.warn(`[diele] ${init.method} ${url} answered ${response.status}`)

    return { outcome: reportLapse(response.status) ? 'lapsed' : 'failed' }
  } catch (error) {
    console.warn(`[diele] ${init.method} ${url} failed:`, error)

    return { outcome: 'failed' }
  }
}

/**
 * Sends one change to what is kept, outdating every read on its way both as it is sent and as it
 * answers, since the api may have served any of them from before the change took effect.
 * @param {string} url - Endpoint to write to
 * @param {RequestInit} init - Method and body
 * @returns {Promise<HistoryWrite>} - How it ended, and whether its answer may still be adopted
 */
export async function sendHistoryWrite(url: string, init: RequestInit): Promise<HistoryWrite> {
  const sentFor = markWrite()
  const written = await postHistory(url, init)
  markWrite()

  return { ...written, current: isSameAccount(sentFor) }
}
