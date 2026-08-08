import { Router } from 'express'
import {
  createEngine,
  deleteEngine,
  listAllEngines,
  reorderEngines,
  setEngineEnabled,
  updateEngine,
} from '#engines/repository.js'
import { createEngineSchema, updateEngineSchema } from '#engines/schemas.js'
import { reorderSchema } from '#fieldSchemas.js'
import { enabledBody, idParam } from './routeParams.js'

export const enginesRouter: Router = Router()

enginesRouter.get('/', (_req, res) => {
  res.json({ rows: listAllEngines() })
})

enginesRouter.post('/', (req, res) => {
  const body = createEngineSchema.parse(req.body)

  res.status(201).json({ engine: createEngine(body) })
})

enginesRouter.patch('/:id', (req, res) => {
  const body = updateEngineSchema.parse(req.body)

  res.json({ engine: updateEngine(idParam(req), body) })
})

enginesRouter.put('/:id/enabled', (req, res) => {
  const enabled = enabledBody(req)

  setEngineEnabled(idParam(req), enabled)
  res.json({ ok: true })
})

// The first entry is the default the bar starts on, so this is also how the default is chosen.
enginesRouter.put('/order', (req, res) => {
  const { ids } = reorderSchema.parse(req.body)

  reorderEngines(ids)
  res.json({ ok: true })
})

enginesRouter.delete('/:id', (req, res) => {
  deleteEngine(idParam(req))
  res.json({ ok: true })
})
