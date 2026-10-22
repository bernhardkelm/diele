import { shallowRef } from 'vue'
import type { ApiHistoryEntry, ApiHistoryState } from '@diele/common'

/** Where the settings list stands: not asked for yet, on its way, on screen, or refused. */
export type KeptStatus = 'unread' | 'reading' | 'read' | 'failed'

/** When a read was sent, so an answer outdated by a write or a sign-out on its way is dropped */
export interface ReadMark {
  readonly account: number
  readonly writes: number
}

export const OFF: ApiHistoryState = {
  available: false,
  sources: { diele: false, extension: false },
  enabled: false,
  excludedDomains: [],
  kept: 0,
}

// Shared at module scope between the search and the settings, which read and write the same
// account's history. Held in memory only, never in storage: where someone has been is not
// something to leave in the browser for whoever opens it next.
export const historyState = shallowRef<ApiHistoryState>(OFF)
/** The most frecent pages, already deduplicated by the api, for the search */
export const historyEntries = shallowRef<ReadonlyArray<ApiHistoryEntry>>([])
/** Every page kept for this account, most recent first, once the settings have read them */
export const keptEntries = shallowRef<ReadonlyArray<ApiHistoryEntry>>([])
export const keptStatus = shallowRef<KeptStatus>('unread')

// Bumped on every reset, so nothing read for the previous account lands for the next one.
let account = 0
// Bumped when a write is sent and again when it answers: a read overlapping either may have been
// served from before the write took effect.
let writes = 0

/**
 * Reads a state the api served, filling in whatever an older api left out rather than trusting it.
 * @param {Partial<ApiHistoryState> | undefined} served - State as it arrived
 * @returns {ApiHistoryState} - A complete state, off wherever it said nothing
 */
export function toState(served: Partial<ApiHistoryState> | undefined): ApiHistoryState {
  return {
    available: served?.available === true,
    sources: { ...OFF.sources, ...served?.sources },
    enabled: served?.enabled === true,
    excludedDomains: served?.excludedDomains ?? [],
    kept: typeof served?.kept === 'number' ? served.kept : 0,
  }
}

/**
 * Marks a read as it is sent.
 * @returns {ReadMark} - The account and write it was sent under
 */
export function markRead(): ReadMark {
  return { account, writes }
}

/**
 * Returns whether a read's answer is outdated: the account changed, or a write was sent or
 * answered while it was on its way.
 * @param {ReadMark} mark - What `markRead` returned as the read was sent
 * @returns {boolean} - True when the answer must be dropped
 */
export function isStale(mark: ReadMark): boolean {
  return mark.account !== account || mark.writes !== writes
}

/**
 * Records a write being sent or answered, outdating every read on its way.
 * @returns {number} - The account the write belongs to
 */
export function markWrite(): number {
  writes += 1

  return account
}

/**
 * Returns whether the account a write was sent under is still the one signed in.
 * @param {number} sentFor - What `markWrite` returned as the write was sent
 * @returns {boolean} - True while nobody signed out since
 */
export function isSameAccount(sentFor: number): boolean {
  return sentFor === account
}

/**
 * Drops everything held and outdates every read and write on its way.
 * @returns {void}
 */
export function resetHistoryState(): void {
  account += 1
  historyState.value = OFF
  historyEntries.value = []
  keptEntries.value = []
  keptStatus.value = 'unread'
}
