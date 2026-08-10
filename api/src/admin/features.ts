import type { ApiFeature } from '@diele/common'
import { BUILT_IN_COMMANDS, listAllCommands } from '#commands/repository.js'
import { config } from '#config.js'
import { listAllEngines } from '#engines/repository.js'
import { listAllLinks } from '#links/repository.js'
import { listAllLocalhost } from '#localhost/repository.js'
import { isEnabled } from '#settings/toggles.js'
import { listUsers } from '#users/repository.js'
import { connectorFeatures } from './connectorFeatures.js'
import { healthFields } from './healthFields.js'
import {
  CARD_FIELDS,
  COMMAND_FIELDS,
  ENGINE_FIELDS,
  LOCALHOST_FIELDS,
  SITE_FIELDS,
  USER_FIELDS,
} from './fields.js'

/**
 * Describes everything the admin view can configure, with the counts as they stand. Built-ins
 * and connectors deliberately share one shape: a connector is only a feature whose rows come
 * from somewhere else, so the UI renders both from this one list.
 * @returns {Promise<ReadonlyArray<ApiFeature>>} - Features in display order
 */
export async function listFeatures(): Promise<ReadonlyArray<ApiFeature>> {
  const cards = listAllLinks('card')
  const sites = listAllLinks('site')
  const engines = listAllEngines()
  const ports = listAllLocalhost()
  const commands = listAllCommands()
  const users = config.authMode === 'local' ? listUsers() : []

  // Built once and shared: the choices are whichever decorators are configured, which is one
  // pair of queries, and cards and sites offer exactly the same ones.
  const liveness = await healthFields()

  return [
    {
      id: 'commands',
      label: 'Slash commands',
      description:
        'Typed as /keyword, with a space before the term. /admin, /settings and /logout are built in.',
      kind: 'builtin',
      produces: ['suggestion'],
      fields: COMMAND_FIELDS,
      collection: '/api/admin/commands',
      count: commands.length + BUILT_IN_COMMANDS.length,
      enabledCount: commands.filter((command) => command.enabled).length + BUILT_IN_COMMANDS.length,
    },
    {
      id: 'engines',
      label: 'Search engines',
      description: 'What Enter submits to. The first is the default; Tab cycles.',
      kind: 'builtin',
      produces: ['engine'],
      fields: ENGINE_FIELDS,
      collection: '/api/admin/engines',
      count: engines.length,
      enabledCount: engines.filter((engine) => engine.enabled).length,
      toggleable: true,
      enabled: isEnabled('engines'),
      toggleHint:
        'the field then hands a term to nothing, so Enter only opens what the portal already knows',
    },
    {
      id: 'cards',
      label: 'Cards',
      description: 'The logo cards on the resting page.',
      kind: 'builtin',
      produces: ['card'],
      fields: [...CARD_FIELDS, ...liveness],
      collection: '/api/admin/links/card',
      count: cards.length,
      enabledCount: cards.filter((card) => card.enabled).length,
      toggleable: true,
      enabled: isEnabled('cards'),
      toggleHint: 'the front page keeps its rows and loses its logo grid',
    },
    // Inside the cards rather than beside them, because that is where it is configured: the
    // switch owns no rows, and which source reports what is set on each card and saved site.
    {
      id: 'health',
      label: 'Liveness',
      description: 'The dot on a card or saved site, from a probe or a connected monitor.',
      kind: 'builtin',
      produces: [],
      fields: [],
      count: 0,
      enabledCount: 0,
      toggleable: true,
      switchOnly: true,
      parent: 'cards',
      enabled: isEnabled('health'),
      toggleHint: 'every dot goes and the portal stops reaching anything to draw one',
    },
    {
      id: 'sites',
      label: 'Saved sites',
      description: 'Suggested as results when the term matches them.',
      kind: 'builtin',
      produces: ['suggestion'],
      fields: [...SITE_FIELDS, ...liveness],
      collection: '/api/admin/links/site',
      count: sites.length,
      enabledCount: sites.filter((site) => site.enabled).length,
      toggleable: true,
      enabled: isEnabled('sites'),
      toggleHint: 'saved sites stop being suggested; the entries are kept',
    },
    {
      id: 'localhost',
      label: 'Local ports',
      description: 'Dev servers on this machine, offered with a dot when something answers.',
      kind: 'builtin',
      produces: ['suggestion'],
      fields: LOCALHOST_FIELDS,
      collection: '/api/admin/localhost',
      count: ports.length,
      enabledCount: ports.filter((port) => port.enabled).length,
      toggleable: true,
      enabled: isEnabled('localhost'),
      toggleHint:
        'the portal probes each port on every load, so leave it off unless this machine runs them',
    },
    {
      id: 'reddit',
      label: 'Subreddit jump',
      description: 'Typing r/name or /r/name offers that subreddit instead of a search.',
      kind: 'builtin',
      produces: ['suggestion'],
      fields: [],
      count: 0,
      enabledCount: 0,
      toggleable: true,
      switchOnly: true,
      enabled: isEnabled('reddit'),
      toggleHint: 'costs nothing until a term is written as a subreddit path',
    },
    // Only where the portal owns its accounts. Against an issuer the account list lives there,
    // and offering to edit it here would promise something this process cannot do.
    ...(config.authMode === 'local'
      ? [
          {
            id: 'users',
            label: 'Users',
            description: 'Accounts that can sign in to this portal.',
            kind: 'builtin' as const,
            produces: [],
            fields: USER_FIELDS,
            count: users.length,
            enabledCount: users.filter((user) => user.isAdmin).length,
            unavailable: 'only the first account exists; adding more is not built yet',
            unavailableReason: 'planned' as const,
          },
        ]
      : []),
    ...connectorFeatures(),
  ]
}
