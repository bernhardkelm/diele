import { Router, type Request } from 'express'
import { badRequest } from '#errors.js'
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

linksRouter.get('/:kind', (req, res) => {
  res.json({ rows: listAllLinks(kindParam(req)) })
})

linksRouter.post('/:kind', (req, res) => {
  const kind = kindParam(req)
  const body = createLinkSchema.parse({ ...(req.body as object), kind })

  res.status(201).json({ link: createLink(body) })
})

linksRouter.patch('/:kind/:id', (req, res) => {
  kindParam(req)
  const body = updateLinkSchema.parse(req.body)

  res.json({ link: updateLink(idParam(req), body) })
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
  kindParam(req)
  deleteLink(idParam(req))
  res.json({ ok: true })
})
