import { Router } from 'express'
import { wakeScheduler } from '#connectors/scheduler.js'
import { badRequest } from '#errors.js'
import { resetHealth } from '#health/cache.js'
import { isToggleable, setEnabled } from '#settings/toggles.js'
import { commandsRouter } from './commandsRoutes.js'
import { connectorRouter } from './connectorRoutes.js'
import { enginesRouter } from './enginesRoutes.js'
import { listFeatures } from './features.js'
import { iconsRouter } from './iconsRoutes.js'
import { linksRouter } from './linksRoutes.js'
import { localhostRouter } from './localhostRoutes.js'
import { enabledBody } from './routeParams.js'
import { buildExport } from './exportConfig.js'
import { applyImport, importSchema } from './importConfig.js'

export const adminRouter: Router = Router()

// Every feature that owns rows answers `{ rows }`, so the client reads one key whatever it
// opened and a new connector needs no case of its own there.
adminRouter.use('/connectors', connectorRouter)
adminRouter.use('/links', linksRouter)
adminRouter.use('/commands', commandsRouter)
adminRouter.use('/localhost', localhostRouter)
adminRouter.use('/engines', enginesRouter)
adminRouter.use('/icons', iconsRouter)

adminRouter.get('/features', (_req, res) => {
  res.json({ features: listFeatures() })
})

// Turns a whole feature off, which is not the same as it having no rows.
adminRouter.put('/features/:id/enabled', (req, res) => {
  const id = req.params.id

  if (!isToggleable(id)) {
    throw badRequest('that feature cannot be turned off')
  }

  setEnabled(id, enabledBody(req))
  res.json({ ok: true })
})

adminRouter.get('/export', (_req, res) => {
  res.json(buildExport())
})

adminRouter.post('/import', (req, res) => {
  const payload = importSchema.parse(req.body)
  const written = applyImport(payload)

  // Every connector the file brought is due as of this moment, so this only saves it the wait
  // until the next tick.
  wakeScheduler()
  // The readings in memory were resolved against the configuration this just replaced, and a
  // ref surviving the swap would keep its old dot until the next refresh aged it out.
  resetHealth()

  res.json({ ok: true, written })
})
