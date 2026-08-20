import type { Signal } from '#connectors/types.js'
import { signalFrom, type AlertMapping } from './signalRules.js'
import type { ManagedAlertRecord } from './client.js'

/**
 * Reads everything an Alertmanager is holding, in the order it sent them.
 *
 * The request already asks for the active ones alone, so a silenced alert never arrives here to
 * be filtered out. The state is checked anyway: this is the one place a silence could leak onto
 * the portal, and an Alertmanager that ignored the query would do it silently.
 * @param {ReadonlyArray<ManagedAlertRecord>} alerts - Alerts as the v2 API sent them
 * @param {AlertMapping} mapping - Which instance these came from and what it reports
 * @returns {ReadonlyArray<Signal>} - Signals for the alerts that survived the filter
 */
export function managedSignalsOf(
  alerts: ReadonlyArray<ManagedAlertRecord>,
  mapping: AlertMapping,
): ReadonlyArray<Signal> {
  return alerts.flatMap((alert) => {
    // `suppressed` is silenced or inhibited, and `unprocessed` is one it has not decided about
    // yet. Only what it calls active is something to put in front of anyone.
    if (alert.status?.state !== 'active') {
      return []
    }

    const signal = signalFrom({
      labels: alert.labels ?? {},
      annotations: alert.annotations ?? {},
      connectorId: mapping.connectorId,
      floor: mapping.floor,
      hideWatchdog: mapping.hideWatchdog,
      // The alert says where its own rule can be read, which is better than the list it came in:
      // it lands on the expression that fired rather than on everything that is firing.
      href: alert.generatorURL?.trim() || `${mapping.baseUrl}/#/alerts`,
      ...(alert.startsAt ? { since: alert.startsAt } : {}),
    })

    return signal ? [signal] : []
  })
}
