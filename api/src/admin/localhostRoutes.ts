import { Router } from 'express'
import { reorderSchema } from '#fieldSchemas.js'
import {
  createLocalhost,
  deleteLocalhost,
  listAllLocalhost,
  reorderLocalhost,
  setLocalhostRowEnabled,
  updateLocalhost,
} from '#localhost/repository.js'
import { createLocalhostSchema, updateLocalhostSchema } from '#localhost/schemas.js'
import { enabledBody, idParam } from './routeParams.js'

export const localhostRouter: Router = Router()

localhostRouter.get('/', (_req, res) => {
  res.json({ rows: listAllLocalhost() })
})

localhostRouter.post('/', (req, res) => {
  res.status(201).json({ port: createLocalhost(createLocalhostSchema.parse(req.body)) })
})

localhostRouter.patch('/:id', (req, res) => {
  res.json({ port: updateLocalhost(idParam(req), updateLocalhostSchema.parse(req.body)) })
})

localhostRouter.put('/:id/enabled', (req, res) => {
  setLocalhostRowEnabled(idParam(req), enabledBody(req))
  res.json({ ok: true })
})

localhostRouter.put('/order', (req, res) => {
  reorderLocalhost(reorderSchema.parse(req.body).ids)
  res.json({ ok: true })
})

localhostRouter.delete('/:id', (req, res) => {
  deleteLocalhost(idParam(req))
  res.json({ ok: true })
})
