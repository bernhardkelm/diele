import { z } from 'zod'
import { isHttpUrl } from '#fieldSchemas.js'
import type { ApiFieldSpec } from '@diele/common'
import { checkGroup, checkToken, fetchGroupProjects, fetchVisibleGroups } from './client.js'
import { mapGroup, mergeProjects } from './map.js'
import { messageOf } from '#connectors/redact.js'
import type {
  ConnectorContext,
  ConnectorModule,
  EntriesResult,
  VerifyContext,
} from '#connectors/types.js'

const FIELDS: ReadonlyArray<ApiFieldSpec> = [
  {
    key: 'baseUrl',
    label: 'Instance',
    input: 'url',
    required: true,
    placeholder: 'https://gitlab.com',
    hint: 'origin only; a self-hosted instance goes here instead',
  },
  {
    key: 'groups',
    label: 'Groups',
    input: 'keywords',
    placeholder: 'example-group, another-group',
    hint: 'comma separated; leave empty for every group the token can see',
  },
  {
    key: 'token',
    label: 'Access token',
    input: 'secret',
    required: true,
    hint: 'a personal access token with read_api; stored encrypted and never returned',
  },
  {
    key: 'includeSubgroups',
    label: 'Include subgroups',
    input: 'toggle',
    default: true,
    hint: 'repos of nested groups are listed alongside the group’s own',
  },
]

const configSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .min(1)
    .default('https://gitlab.com')
    .refine(isHttpUrl, 'must be an absolute http(s) url')
    // trailing slashes would double up in every url built from this
    .transform((value) => value.replace(/\/+$/, '')),
  // Empty is a value rather than a mistake: it means whichever groups the token can see, which
  // is the useful default for a token issued for exactly that.
  groups: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  includeSubgroups: z.boolean().default(true),
})

/**
 * Checks that the token reaches every configured group before anything is stored.
 *
 * Every group rather than the first: a save that succeeded and then quietly listed nothing for
 * one of them is exactly the failure this is here to catch. Reading each group's own record
 * rather than its projects keeps it to one small request each.
 * @param {VerifyContext} context - Validated config, the submitted credentials and a deadline
 * @returns {Promise<void>}
 */
async function verify(context: VerifyContext): Promise<void> {
  const { baseUrl, groups } = configSchema.parse(context.config)

  const token = context.secrets.token
  if (!token) {
    throw new Error('no access token was given')
  }

  // Nothing named means nothing to check per group, so the token itself is what is asked about.
  if (groups.length === 0) {
    await checkToken(baseUrl, token, context.signal)
    return
  }

  for (const group of groups) {
    await checkGroup(baseUrl, group, token, context.signal)
  }
}

/**
 * Collects every repo of the configured groups, plus one search-only row per group opening its
 * own GitLab page. A connector naming no groups stands for every group the token can see.
 *
 * A group that fails is dropped rather than failing the run, which is what keeps one
 * misconfigured group from emptying the section. The run is then reported as partial so the
 * entries of the groups that did answer are not swept either. Every group failing is an
 * unreachable GitLab rather than an empty one, so that throws.
 * @param {ConnectorContext} context - Validated config, decrypted credentials and the run's signal
 * @returns {Promise<EntriesResult>} - Repos and group rows, marked partial when a group failed
 */
async function collect(context: ConnectorContext): Promise<EntriesResult> {
  const { baseUrl, groups: named, includeSubgroups } = configSchema.parse(context.config)

  const token = context.secrets.token
  if (!token) {
    throw new Error('no access token is stored for this connector')
  }

  // Resolved on every run rather than stored: a token given access to another group later
  // should start listing it without anyone opening the connector to say so.
  const groups = named.length > 0 ? named : await fetchVisibleGroups(baseUrl, token, context.signal)

  if (groups.length === 0) {
    throw new Error('this token can see no groups')
  }

  const settled = await Promise.allSettled(
    groups.map((group) =>
      fetchGroupProjects(baseUrl, group, token, includeSubgroups, context.signal),
    ),
  )

  const answered: Array<ReadonlyArray<unknown>> = []
  const failures: string[] = []

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      answered.push(result.value)
    } else {
      failures.push(`${groups[index]}: ${messageOf(result.reason)}`)
    }
  })

  if (answered.length === 0) {
    throw new Error(`no group could be read (${failures.join('; ')})`)
  }

  const reached = groups.filter((_group, index) => settled[index]?.status === 'fulfilled')

  return {
    entries: [...reached.map((group) => mapGroup(baseUrl, group)), ...mergeProjects(answered)],
    partial: failures.length > 0,
  }
}

export const gitlabModule: ConnectorModule = {
  type: 'gitlab',
  label: 'GitLab',
  description: 'Repos of the token’s groups, listed below the cards.',
  produces: ['row'],
  fields: FIELDS,
  secretKeys: ['token'],
  parseConfig: (input) => configSchema.parse(input),
  defaultIntervalSeconds: 900,
  verify,
  collect,
}
