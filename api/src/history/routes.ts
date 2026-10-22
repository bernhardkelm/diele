import type { ApiHistory } from '@diele/common'
import { Router } from 'express'
import { idParam } from '#admin/routeParams.js'
import { badRequest, forbidden, notFound, tooManyRequests, unauthorized } from '#errors.js'
import { ensureHistoryKey, readHistoryKey } from '#users/historyKey.js'
import { normaliseDomain } from './domains.js'
import { clearEntries, deleteEntry, deleteOnDomains, listEntries } from './entries.js'
import { startIngest } from './ingest.js'
import { readPreferences, writePreferences } from './preferences.js'
import { preferencesSchema, visitsSchema } from './schemas.js'
import { servedEntries } from './served.js'
import { isAvailable, isSourceOn, readState } from './state.js'

export const historyRouter: Router = Router()

// Not even a private cache may keep these: a copy on disk outlives the delete that removed the
// entries from the database. Overrides the `private, no-cache` every api response starts with.
historyRouter.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

/**
 * Normalises a list of domains, refusing the whole list over one that is not a hostname rather
 * than quietly keeping less than was asked for.
 * @param {ReadonlyArray<string>} raw - Domains as written
 * @returns {ReadonlyArray<string>} - Hostnames, deduplicated, in the order given
 */
function domainsOf(raw: ReadonlyArray<string>): ReadonlyArray<string> {
  const domains: string[] = []

  for (const entry of raw) {
    const domain = normaliseDomain(entry)
    if (!domain) {
      throw badRequest(`${entry.slice(0, 100)} is not a domain`)
    }

    if (!domains.includes(domain)) {
      domains.push(domain)
    }
  }

  return domains
}

// The state is served whatever the switches say, because it is how the portal knows what to
// show: nothing, an offer to opt in, or the entries themselves.
historyRouter.get('/', (req, res) => {
  if (!req.user) {
    throw unauthorized()
  }

  const owner = readHistoryKey(req.user.id)
  const state = readState(owner)
  const payload: ApiHistory = {
    state,
    entries: state.available && state.enabled ? servedEntries(owner) : [],
  }

  res.json(payload)
})

// Served whatever the switches say: what was kept is the account's own, and seeing it is how it
// gets removed, which must keep working after an admin has turned the feature off.
historyRouter.get('/entries', (req, res) => {
  if (!req.user) {
    throw unauthorized()
  }

  res.json({ entries: listEntries(readHistoryKey(req.user.id)) })
})

// Answered before anything is probed: a probe can take seconds, and the page that sent this is
// already on its way somewhere else. Refusals are 403 rather than 401, because the portal reads
// a 401 as a session that lapsed and sends the person to sign in again.
historyRouter.post('/visits', (req, res) => {
  if (!req.user) {
    throw unauthorized()
  }

  const batch = visitsSchema.parse(req.body)

  if (!isAvailable()) {
    throw forbidden('history is not offered on this portal')
  }

  if (!isSourceOn(batch.source)) {
    throw forbidden('this portal does not accept visits from that source')
  }

  const owner = readHistoryKey(req.user.id)
  if (owner === undefined || !readPreferences(owner).enabled) {
    throw forbidden('history is off for this account')
  }

  // 429 rather than a quiet drop, so a source can tell its visit was not taken and send it again.
  if (!startIngest(owner, batch)) {
    throw tooManyRequests('earlier visits are still being checked, send these again shortly')
  }

  res.json({ ok: true })
})

historyRouter.delete('/entries/:id', (req, res) => {
  if (!req.user) {
    throw unauthorized()
  }

  // The same answer for an id that does not exist and one that is someone else's, so the
  // route cannot be used to learn which ids are taken.
  if (!deleteEntry(readHistoryKey(req.user.id), idParam(req))) {
    throw notFound('history entry not found')
  }

  res.json({ ok: true })
})

historyRouter.delete('/entries', (req, res) => {
  if (!req.user) {
    throw unauthorized()
  }

  clearEntries(readHistoryKey(req.user.id))
  res.json({ ok: true })
})

// Works whatever the switches say, so an account can opt out or narrow what is kept before an
// admin turns anything on. Opting out keeps what is there; excluding a domain is the explicit
// request to forget it, so what the account holds on it goes at once.
historyRouter.put('/preferences', (req, res) => {
  if (!req.user) {
    throw unauthorized()
  }

  const input = preferencesSchema.parse(req.body)
  const owner = ensureHistoryKey(req.user.id)
  const current = readPreferences(owner)
  const excludedDomains = input.excludedDomains
    ? domainsOf(input.excludedDomains)
    : current.excludedDomains

  writePreferences(owner, {
    enabled: input.enabled ?? current.enabled,
    excludedDomains,
  })

  const added = excludedDomains.filter((domain) => !current.excludedDomains.includes(domain))
  deleteOnDomains(owner, added)

  res.json(readState(owner))
})
