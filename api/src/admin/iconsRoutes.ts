import { Router } from 'express'
import { createIcon, deleteIcon, listIcons } from '#icons/repository.js'
import { createIconSchema } from '#icons/schemas.js'
import { idParam } from './routeParams.js'

export const iconsRouter: Router = Router()

iconsRouter.get('/', (_req, res) => {
  res.json({ icons: listIcons() })
})

iconsRouter.post('/', (req, res) => {
  const body = createIconSchema.parse(req.body)

  res.status(201).json({ icon: createIcon(body.name, body.svg) })
})

iconsRouter.delete('/:id', (req, res) => {
  deleteIcon(idParam(req))
  res.json({ ok: true })
})
