import { isHttpUrl } from '#fieldSchemas.js'
import type { Signal } from '#connectors/types.js'
import { signalFrom, type AlertMapping } from './signalRules.js'
import type { ManagedAlertRecord } from './client.js'

/**
 * Returns where an alert says its own rule can be read, or the list it arrived in.
 *
 * An Alertmanager holds whatever was sent to it, so this field is a remote sender's word rather
 * than an operator's, and it is rendered as a link on the portal's own page. Anything but an
 * absolute http(s) url is treated as the alert having named no link at all.
 * @param {string | undefined} generatorURL - Link the alert carried, when it carried one
 * @param {string} baseUrl - Alertmanager origin, for the list this alert appears in
 * @returns {string} - A url safe to hand the browser
 */
function linkFor(generatorURL: string | undefined, baseUrl: string): string {
  const named = generatorURL?.trim()

  if (named && isHttpUrl(named)) {
    return named
  }

  return `${baseUrl}/#/alerts`
}

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
      href: linkFor(alert.generatorURL, mapping.baseUrl),
      ...(alert.startsAt ? { since: alert.startsAt } : {}),
    })

    return signal ? [signal] : []
  })
}
