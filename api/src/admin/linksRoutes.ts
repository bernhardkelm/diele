import { Router, type Request } from 'express'
import { linkRef } from '#connectors/refs.js'
import { getDb } from '#db/index.js'
import { badRequest, notFound } from '#errors.js'
import { reorderSchema } from '#fieldSchemas.js'
import {
  createLink,
  deleteLink,
  listAllLinks,
  reorderLinks,
  setLinkEnabled,
  updateLink,
} from '#links/repository.js'
import { createLinkSchema, linkKindSchema, updateLinkSchema } from '#links/schemas.js'
import { peekReading, probeNow } from '#health/cache.js'
import { clearBinding } from '#health/repository.js'
import { applyBinding, decorateRow } from './healthBinding.js'
import { enabledBody, idParam } from './routeParams.js'

export const linksRouter: Router = Router()

/**
 * Reads the link kind out of the path, so cards and sites share one set of routes without the
 * path being able to name a table that does not exist.
 * @param {Request} req - Request carrying the kind parameter
 * @returns {'card' | 'site'} - The validated kind
 */
function kindParam(req: Request): 'card' | 'site' {
  const parsed = linkKindSchema.safeParse(req.params.kind)
  if (!parsed.success) {
    throw badRequest('kind must be card or site')
  }

  return parsed.data
}

// The list draws the same dot the portal does, from what is already held rather than by reaching
// anything: opening the panel is not a reason to poll every service someone has bound.
linksRouter.get('/:kind', (req, res) => {
  const rows = listAllLinks(kindParam(req)).map((row) => decorateRow(row, peekReading(row.ref)))

  res.json({ rows })
})

linksRouter.post('/:kind', async (req, res) => {
  const kind = kindParam(req)
  const body = createLinkSchema.parse({ ...(req.body as object), kind })

  // One transaction, because the binding is keyed by the ref the new id is part of and so cannot
  // be checked first. A refused binding then takes the half-made link back with it.
  const link = getDb().transaction(() => {
    const created = createLink(body)
    applyBinding(created.ref, req.body)

    return created
  })()

  res.status(201).json({ link: decorateRow(link, await probeNow(link.ref)) })
})

linksRouter.patch('/:kind/:id', async (req, res) => {
  kindParam(req)
  const body = updateLinkSchema.parse(req.body)
  const id = idParam(req)

  // Together, so a refused binding does not leave the fields beside it saved under a 400.
  const link = getDb().transaction(() => {
    const updated = updateLink(id, body)
    applyBinding(updated.ref, req.body)

    return updated
  })()

  // Resolved before answering, the way a connector's settings are checked before they are
  // stored, so the panel says whether the binding works while the person who made it is still
  // looking at it. Unlike a connector this cannot refuse the save: a service that is down is a
  // fact about the service, not a mistake in the binding.
  res.json({ link: decorateRow(link, await probeNow(link.ref)) })
})

// The same probe the save runs, on its own. `sync` rather than a name of its own, because it is
// the row action every other feature already spells that way: ask the source again, now.
linksRouter.post('/:kind/:id/sync', async (req, res) => {
  const kind = kindParam(req)
  const id = idParam(req)
  const ref = linkRef(kind, id)

  const row = listAllLinks(kind).find((entry) => entry.id === id)
  if (!row) {
    throw notFound('link not found')
  }

  res.json({ link: decorateRow(row, await probeNow(ref)) })
})

linksRouter.put('/:kind/:id/enabled', (req, res) => {
  kindParam(req)
  const enabled = enabledBody(req)

  setLinkEnabled(idParam(req), enabled)
  res.json({ ok: true })
})

linksRouter.put('/:kind/order', (req, res) => {
  const kind = kindParam(req)
  const { ids } = reorderSchema.parse(req.body)

  reorderLinks(kind, ids)
  res.json({ ok: true })
})

linksRouter.delete('/:kind/:id', (req, res) => {
  const kind = kindParam(req)
  const id = idParam(req)

  deleteLink(id)
  // A binding is keyed by ref rather than by a foreign key, because one table binds rows of
  // several tables. Nothing cascades here, so the route that removed the link removes it.
  clearBinding(linkRef(kind, id))

  res.json({ ok: true })
})
