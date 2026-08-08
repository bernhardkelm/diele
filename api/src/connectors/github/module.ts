import { z } from 'zod'
import { isHttpUrl } from '#fieldSchemas.js'
import type { ApiFieldSpec } from '@diele/common'
import {
  apiRootOf,
  checkOwner,
  checkToken,
  fetchOwnerRepos,
  fetchViewerLogin,
  fetchViewerRepos,
} from './client.js'
import { mapOwner, mergeRepos } from './map.js'
import { messageOf } from '#connectors/redact.js'
import type {
  ConnectorContext,
  ConnectorModule,
  EntriesResult,
  ProducedEntry,
  VerifyContext,
} from '#connectors/types.js'

const FIELDS: ReadonlyArray<ApiFieldSpec> = [
  {
    key: 'baseUrl',
    label: 'Instance',
    input: 'url',
    required: true,
    placeholder: 'https://github.com',
    hint: 'origin only; a GitHub Enterprise instance goes here instead',
  },
  {
    key: 'owners',
    label: 'Orgs and users',
    input: 'keywords',
    placeholder: 'example-org, example-user',
    hint: 'comma separated; leave empty for every repo the token can see',
  },
  {
    key: 'token',
    label: 'Access token',
    input: 'secret',
    required: true,
    hint: 'a personal access token with repo read access; stored encrypted and never returned',
  },
]

const configSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .min(1)
    .default('https://github.com')
    .refine(isHttpUrl, 'must be an absolute http(s) url')
    // trailing slashes would double up in every url built from this
    .transform((value) => value.replace(/\/+$/, '')),
  // Empty is a value rather than a mistake: it means whichever repos the token can see, which
  // is the useful default for a token issued for exactly that.
  owners: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
})

/**
 * Checks that the token reaches every configured org or user before anything is stored.
 *
 * Every owner rather than the first: a save that succeeded and then quietly listed nothing for
 * one of them is exactly the failure this is here to catch. Reading each owner's own record
 * rather than its repos keeps it to one small request each.
 * @param {VerifyContext} context - Validated config, the submitted credentials and a deadline
 * @returns {Promise<void>}
 */
async function verify(context: VerifyContext): Promise<void> {
  const { baseUrl, owners } = configSchema.parse(context.config)
  const apiRoot = apiRootOf(baseUrl)

  const token = context.secrets.token
  if (!token) {
    throw new Error('no access token was given')
  }

  // Nothing named means nothing to check per owner, so the token itself is what is asked about.
  if (owners.length === 0) {
    await checkToken(apiRoot, token, context.signal)
    return
  }

  for (const owner of owners) {
    await checkOwner(apiRoot, owner, token, context.signal)
  }
}

/**
 * Builds one search-only owner row per distinct owner the mapped repos name, for a connector
 * that named none itself. Keyed by the lowercased login so two casings of one owner cannot
 * produce two rows with the same ref.
 * @param {string} baseUrl - GitHub origin, e.g. `https://github.com`
 * @param {ReadonlyArray<ProducedEntry>} repos - Mapped repo rows
 * @returns {ReadonlyArray<ProducedEntry>} - One owner row per distinct owner
 */
function ownersOf(
  baseUrl: string,
  repos: ReadonlyArray<ProducedEntry>,
): ReadonlyArray<ProducedEntry> {
  const byLogin = new Map<string, string>()

  for (const repo of repos) {
    const owner = repo.detail
    if (owner && !byLogin.has(owner.toLowerCase())) {
      byLogin.set(owner.toLowerCase(), owner)
    }
  }

  return [...byLogin.values()].map((owner) => mapOwner(baseUrl, owner))
}

/**
 * Collects every repo of the configured orgs and users, plus one search-only row per owner
 * opening its own GitHub page. A connector naming no owners stands for every repo the token
 * can see.
 *
 * An owner that fails is dropped rather than failing the run, which is what keeps one
 * misconfigured owner from emptying the section. The run is then reported as partial so the
 * entries of the owners that did answer are not swept either. Every owner failing is an
 * unreachable GitHub rather than an empty one, so that throws.
 * @param {ConnectorContext} context - Validated config, decrypted credentials and the run's signal
 * @returns {Promise<EntriesResult>} - Repos and owner rows, marked partial when an owner failed
 */
async function collect(context: ConnectorContext): Promise<EntriesResult> {
  const { baseUrl, owners: named } = configSchema.parse(context.config)
  const apiRoot = apiRootOf(baseUrl)

  const token = context.secrets.token
  if (!token) {
    throw new Error('no access token is stored for this connector')
  }

  if (named.length === 0) {
    const repos = mergeRepos([await fetchViewerRepos(apiRoot, token, context.signal)])

    // A token scoped down to nothing must fail the run and leave the last sync standing, not
    // sweep the section.
    if (repos.length === 0) {
      throw new Error('this token can see no repos')
    }

    return { entries: [...ownersOf(baseUrl, repos), ...repos] }
  }

  // Resolved on every run rather than stored: the login decides which owner is read through
  // `/user/repos`, and a token swapped for another user's must not keep the old answer.
  const viewerLogin = await fetchViewerLogin(apiRoot, token, context.signal)

  const settled = await Promise.allSettled(
    named.map((owner) => fetchOwnerRepos(apiRoot, owner, token, viewerLogin, context.signal)),
  )

  const answered: Array<ReadonlyArray<unknown>> = []
  const failures: string[] = []

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      answered.push(result.value)
    } else {
      failures.push(`${named[index]}: ${messageOf(result.reason)}`)
    }
  })

  if (answered.length === 0) {
    throw new Error(`no org or user could be read (${failures.join('; ')})`)
  }

  const reached = named.filter((_owner, index) => settled[index]?.status === 'fulfilled')

  return {
    entries: [...reached.map((owner) => mapOwner(baseUrl, owner)), ...mergeRepos(answered)],
    partial: failures.length > 0,
  }
}

export const githubModule: ConnectorModule = {
  type: 'github',
  label: 'GitHub',
  description: 'Repos of the configured orgs and users, alongside the GitLab ones.',
  mark: 'gh',
  produces: ['row'],
  fields: FIELDS,
  secretKeys: ['token'],
  parseConfig: (input) => configSchema.parse(input),
  defaultIntervalSeconds: 900,
  verify,
  collect,
}
