import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useVisibilityChange } from '@/composables/useVisibilityChange'
import type { CardTarget } from '@/types/portal'
import { UPTIME_HEARTBEAT_URL, UPTIME_POLL_MS, UPTIME_SUMMARY_URL } from '@/config/uptime'
import { mapServiceStatus, type ServiceStatus } from '@/helpers/uptime'

export interface ServiceStatusSource {
  statusFor: (service: CardTarget) => ServiceStatus | undefined
}

/**
 * Polls the proxied Uptime Kuma status page and exposes the result per card.
 * Any failure clears every status, so a portal that cannot reach Kuma shows no dots
 * rather than a wall of red.
 * @param {() => ReadonlyArray<CardTarget>} services - Cards to resolve monitors for, read on each poll
 * @returns {ServiceStatusSource} - Reactive statuses and their controls
 */
export function useServiceStatus(services: () => ReadonlyArray<CardTarget>): ServiceStatusSource {
  const statuses = ref(new Map<string, ServiceStatus>())
  let timer: ReturnType<typeof setInterval> | undefined

  /**
   * Fetches both status page endpoints and rebuilds the status map.
   * @returns {Promise<void>}
   */
  async function refresh(): Promise<void> {
    try {
      const [summaryResponse, heartbeatResponse] = await Promise.all([
        fetch(UPTIME_SUMMARY_URL, { headers: { accept: 'application/json' } }),
        fetch(UPTIME_HEARTBEAT_URL, { headers: { accept: 'application/json' } }),
      ])
      if (!summaryResponse.ok || !heartbeatResponse.ok) {
        throw new Error(
          `summary ${summaryResponse.status}, heartbeat ${heartbeatResponse.status}; ` +
            'Kuma answers 404 when the status page slug is unknown or unpublished',
        )
      }

      const [summary, heartbeats] = await Promise.all([
        summaryResponse.json(),
        heartbeatResponse.json(),
      ])
      statuses.value = mapServiceStatus(services(), summary, heartbeats)
    } catch (error) {
      // dropping every dot looks identical to "nothing is monitored", so name the cause
      console.warn('[diele] status dots unavailable:', error)
      statuses.value = new Map()
    }
  }

  /**
   * Returns the status of a card.
   * @param {CardTarget} service - Card to look up
   * @returns {ServiceStatus | undefined} - Status, or undefined when unmonitored
   */
  function statusFor(service: CardTarget): ServiceStatus | undefined {
    return statuses.value.get(service.ref)
  }

  /**
   * Restarts polling, immediately refreshing once.
   * @returns {void}
   */
  function start(): void {
    stop()
    void refresh()
    timer = setInterval(() => void refresh(), UPTIME_POLL_MS)
  }

  /**
   * Stops polling.
   * @returns {void}
   */
  function stop(): void {
    if (timer !== undefined) {
      clearInterval(timer)
    }
    timer = undefined
  }

  // a backgrounded portal stays idle rather than polling into a tab nobody is looking at
  useVisibilityChange((hidden) => {
    if (hidden) {
      stop()
      return
    }

    start()
  })

  onMounted(start)
  onBeforeUnmount(stop)

  return { statusFor }
}
