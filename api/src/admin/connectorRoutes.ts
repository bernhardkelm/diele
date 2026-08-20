import { Router, type Request } from 'express'
import { getDb } from '#db/index.js'
import { badRequest, notFound } from '#errors.js'
import { enabledBody, idParam } from './routeParams.js'
import {
  createConnector,
  deleteConnector,
  listConnectors,
  readConnector,
  reorderConnectors,
  setConnectorEnabled,
  updateConnector,
} from '#connectors/repository.js'
import {
  requireModule,
  requireSecrets,
  splitConnectorBody,
  toAdminRow,
} from '#connectors/schemas.js'
import { reorderSchema } from '#fieldSchemas.js'
import { runSync } from '#connectors/sync.js'
import { verifyConnector } from '#connectors/verify.js'
import { readSecrets, writeSecret } from '#secrets/repository.js'
import { forgetSource } from '#signals/cache.js'

export const connectorRouter: Router = Router()

/** Matches every connector module's own default, and only applies when none names one. */
const DEFAULT_INTERVAL_S = 900

/**
 * Resolves the row a `:type/:id` pair names, refusing a pair that does not belong together. The
 * type alone decides which module handles the request, so without this a row could be edited or
 * deleted through another type's route and be handled by the wrong module.
 * @param {Request<{ type: string; id: string }>} req - Request carrying both parameters
 * @returns {number} - The row's id
 */
function scopedIdParam(req: Request<{ type: string; id: string }>): number {
  const module = requireModule(req.params.type)
  const id = idParam(req)

  if (readConnector(id).type !== module.type) {
    throw notFound('connector not found')
  }

  return id
}

connectorRouter.get('/:type', (req, res) => {
  const module = requireModule(req.params.type)

  res.json({ rows: listConnectors(module.type).map((row) => toAdminRow(row, module)) })
})

connectorRouter.post('/:type', async (req, res) => {
  const module = requireModule(req.params.type)
  const body = splitConnectorBody(module, req.body)

  if (!body.label) {
    throw badRequest('Name is required')
  }

  requireSecrets(module, body.secrets)

  const config = module.parseConfig(body.config)
  await verifyConnector(module, config, body.secrets)

  // One transaction: a credential that fails to seal must not leave a connector behind that
  // would then spend every interval failing for a reason nobody entered.
  const created = getDb().transaction(() => {
    const connector = createConnector({
      type: module.type,
      label: body.label!,
      config,
      syncIntervalSeconds:
        body.syncIntervalSeconds ?? module.defaultIntervalSeconds ?? DEFAULT_INTERVAL_S,
    })

    for (const [key, value] of Object.entries(body.secrets)) {
      writeSecret(connector.id, key, value)
    }

    return connector.id
  })()

  // Straight away rather than on the next tick, so the row it answers with already reports what
  // the connector found and the portal has it before anyone leaves the panel.
  await runSync(created)

  res.status(201).json({ row: toAdminRow(readConnector(created), module) })
})

connectorRouter.patch('/:type/:id', async (req, res) => {
  const module = requireModule(req.params.type)
  const id = scopedIdParam(req)
  const current = readConnector(id)
  const body = splitConnectorBody(module, req.body)

  // Merged over what is stored rather than replacing it, so a form that submits one field does
  // not drop the rest and a full form still validates as a whole.
  const config = module.parseConfig({ ...current.config, ...body.config })

  // An edit is checked the same way a new one is, against whatever it would be saved as: the
  // credentials it carries, or the stored ones when the form left the box empty.
  await verifyConnector(module, config, { ...readSecrets(id), ...body.secrets })

  getDb().transaction(() => {
    updateConnector(id, {
      ...(body.label !== undefined ? { label: body.label } : {}),
      ...(body.syncIntervalSeconds !== undefined
        ? { syncIntervalSeconds: body.syncIntervalSeconds }
        : {}),
      config,
    })

    for (const [key, value] of Object.entries(body.secrets)) {
      writeSecret(id, key, value)
    }
  })()

  // What it reports is decided as it is read, so the answer held from before this edit is now the
  // old settings' answer. Dropped rather than left to lapse, which is what made a narrowed floor
  // look like it had not taken until the interval came round.
  forgetSource(id)

  await runSync(id)

  res.json({ row: toAdminRow(readConnector(id), module) })
})

connectorRouter.put('/:type/:id/enabled', (req, res) => {
  const id = scopedIdParam(req)

  setConnectorEnabled(id, enabledBody(req))
  forgetSource(id)

  res.json({ ok: true })
})

connectorRouter.put('/:type/order', (req, res) => {
  const module = requireModule(req.params.type)
  reorderConnectors(module.type, reorderSchema.parse(req.body).ids)

  res.json({ ok: true })
})

// Refreshing on demand rather than waiting out the interval, which is what tells someone who
// just entered a token whether it works.
connectorRouter.post('/:type/:id/sync', async (req, res) => {
  const module = requireModule(req.params.type)
  const id = scopedIdParam(req)
  const outcome = await runSync(id)

  res.json({ ok: outcome.ok, row: toAdminRow(readConnector(id), module) })
})

connectorRouter.delete('/:type/:id', (req, res) => {
  const id = scopedIdParam(req)

  deleteConnector(id)
  // Its answer would otherwise outlive it by up to an interval, reporting a source that is gone
  forgetSource(id)

  res.json({ ok: true })
})
