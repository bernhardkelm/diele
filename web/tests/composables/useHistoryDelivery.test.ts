import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { clearLapse } from '@/composables/sessionLapse'
import { rereadHistory, resetHistory, useHistory } from '@/composables/useHistory'
import { HISTORY_DELIVERED_EVENT, useHistoryDelivery } from '@/composables/useHistoryDelivery'
import { withSetup } from '@tests/support/withSetup'
import { stubHistoryApi } from '@tests/support/historyApi'
import type { ApiHistoryState } from '@diele/common'

const STATE: ApiHistoryState = {
  available: true,
  sources: { diele: true, extension: true },
  enabled: true,
  excludedDomains: [],
  kept: 3,
}

/**
 * Mounts the search's reader and the delivery listener over it, waits for the first read, and
 * hands the clock over to the test.
 * @param {Partial<ApiHistoryState>} state - What to vary about the state the api serves
 * @returns {Promise<object>} - The api, and the host component to unmount
 */
async function listen(state: Partial<ApiHistoryState> = {}) {
  const api = stubHistoryApi({ state: { ...STATE, ...state } })
  const { result } = withSetup(() => useHistory(() => true))
  const { wrapper } = withSetup(() => useHistoryDelivery(() => true, rereadHistory))

  await vi.waitFor(() => expect(result.state.value.kept).toBe(STATE.kept))
  vi.useFakeTimers()

  return { api, wrapper }
}

/**
 * Dispatches the event the extension sends after a delivery.
 * @returns {void}
 */
function deliver(): void {
  window.dispatchEvent(new Event(HISTORY_DELIVERED_EVENT))
}

afterEach(() => {
  vi.useRealTimers()
  resetHistory()
  clearLapse()
  vi.unstubAllGlobals()
})

describe('useHistoryDelivery', () => {
  // The api writes the delivered visits only after answering, so the read waits for them.
  it('reads the search slice once, after the visits have had time to land', async () => {
    const { api } = await listen()

    deliver()
    await vi.advanceTimersByTimeAsync(299)
    expect(api.calls('/api/history')).toBe(1)

    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(api.calls('/api/history')).toBe(2)

    await vi.advanceTimersByTimeAsync(2000)
    expect(api.calls('/api/history')).toBe(2)
  })

  it('answers a burst with one read, however long it keeps coming within a second', async () => {
    const { api } = await listen()

    for (let step = 0; step < 9; step += 1) {
      deliver()
      await vi.advanceTimersByTimeAsync(100)
    }

    await vi.advanceTimersByTimeAsync(2000)
    await flushPromises()

    expect(api.calls('/api/history')).toBe(2)
  })

  it.each([
    ['the portal does not offer history', { available: false }],
    ['the account has not opted in', { enabled: false }],
    [
      'the portal accepts nothing from the extension',
      { sources: { diele: true, extension: false } },
    ],
  ])('reads nothing while %s', async (_case, state) => {
    const { api } = await listen(state)

    deliver()
    await vi.advanceTimersByTimeAsync(2000)

    expect(api.calls('/api/history')).toBe(1)
  })

  it('takes its listener and any read it was waiting to send down with the component', async () => {
    const removed = vi.spyOn(window, 'removeEventListener')
    const { api, wrapper } = await listen()

    deliver()
    wrapper.unmount()
    deliver()
    await vi.advanceTimersByTimeAsync(2000)

    expect(removed).toHaveBeenCalledWith(HISTORY_DELIVERED_EVENT, expect.any(Function))
    expect(api.calls('/api/history')).toBe(1)
    removed.mockRestore()
  })
})
