import { config } from '#config.js'
import { listConnectors } from '#connectors/repository.js'
import { capabilitiesOf, listModules } from '#connectors/registry.js'
import { connectorFields } from './fields.js'
import type { ApiFeature } from '@diele/common'

/** What every connector refreshes at when its module names nothing. */
const DEFAULT_INTERVAL_S = 900

/**
 * Connectors that are agreed on but not written yet, in the order they are meant to land.
 * Listed rather than left out so the panel says what is coming and in which order, and so the
 * shape each one is expected to take is written down somewhere other than a roadmap.
 *
 * A planned connector has no module behind it: `capabilities` is what it *will* answer to, and
 * `unavailable` is what stops the row being opened in the meantime.
 */
const PLANNED: ReadonlyArray<ApiFeature> = [
  {
    id: 'github',
    label: 'GitHub',
    description: 'Repos of the configured orgs and users, alongside the GitLab ones.',
    kind: 'connector',
    produces: ['row'],
    capabilities: ['entries'],
    fields: [],
    count: 0,
    enabledCount: 0,
    unavailable: 'not built yet',
    unavailableReason: 'planned',
  },
  {
    id: 'uptime-kuma',
    label: 'Uptime Kuma',
    description: 'Monitor states, shown as a dot on the cards they belong to.',
    kind: 'connector',
    produces: [],
    capabilities: ['health'],
    fields: [],
    count: 0,
    enabledCount: 0,
    unavailable: 'not built yet',
    unavailableReason: 'planned',
  },
  {
    id: 'prometheus',
    label: 'Prometheus',
    description: 'Firing alerts at the top of the page, and card states from a query.',
    kind: 'connector',
    produces: [],
    capabilities: ['health', 'signals'],
    fields: [],
    count: 0,
    enabledCount: 0,
    unavailable: 'not built yet',
    unavailableReason: 'planned',
  },
  {
    id: 'grafana',
    label: 'Grafana',
    description: 'Dashboards, suggested as results when the term matches them.',
    kind: 'connector',
    produces: ['suggestion'],
    capabilities: ['entries'],
    fields: [],
    count: 0,
    enabledCount: 0,
    unavailable: 'not built yet',
    unavailableReason: 'planned',
  },
  {
    id: 'notion',
    label: 'Notion',
    description: 'Pages from a private workspace, suggested as you type.',
    kind: 'connector',
    // A synced index rather than a live proxy: Notion's search is slow and rate limited, so
    // per-keystroke queries against it would neither keep up nor stay within the quota. The
    // live search is the deliberate one, typed after the keyword.
    produces: ['suggestion', 'inline'],
    capabilities: ['entries', 'search'],
    fields: [],
    count: 0,
    enabledCount: 0,
    unavailable: 'not built yet',
    unavailableReason: 'planned',
  },
]

/**
 * Describes every registered connector as a feature. A connector *type* is the feature and its
 * *instances* are the rows, so two GitLab instances are two rows under one heading and the
 * admin view needs no code of its own for either.
 *
 * With no usable encryption key the whole set is marked unavailable rather than hidden: a
 * connector that cannot store a credential should say why instead of disappearing.
 * @returns {ReadonlyArray<ApiFeature>} - One feature per registered connector
 */
export function connectorFeatures(): ReadonlyArray<ApiFeature> {
  // Built and working, but with nowhere safe to put a token. Reported as `blocked` rather than
  // `planned` so the panel does not tell someone to wait for a connector that is already here.
  const unavailable = config.secrets.available
    ? undefined
    : 'needs DIELE_SECRET_KEYS set before credentials can be stored'

  const built = listModules().map((module) => {
    const rows = listConnectors(module.type)

    return {
      id: module.type,
      label: module.label,
      description: module.description,
      kind: 'connector' as const,
      produces: module.produces,
      capabilities: capabilitiesOf(module),
      fields: [
        ...connectorFields(module.defaultIntervalSeconds ?? DEFAULT_INTERVAL_S),
        ...module.fields,
      ],
      collection: `/api/admin/connectors/${module.type}`,
      count: rows.length,
      enabledCount: rows.filter((row) => row.enabled).length,
      ...(unavailable ? { unavailable, unavailableReason: 'blocked' as const } : {}),
    }
  })

  const shipped = new Set(built.map((feature) => feature.id))

  return [...built, ...PLANNED.filter((feature) => !shipped.has(feature.id))]
}
