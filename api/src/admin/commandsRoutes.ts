import { Router } from 'express'
import {
  BUILT_IN_COMMANDS,
  createCommand,
  deleteCommand,
  listAllCommands,
  reorderCommands,
  setCommandEnabled,
  updateCommand,
} from '#commands/repository.js'
import { createCommandSchema, updateCommandSchema } from '#commands/schemas.js'
import { reorderSchema } from '#fieldSchemas.js'
import { enabledBody, idParam } from './routeParams.js'

export const commandsRouter: Router = Router()

// Built-ins lead the list and are marked read-only, so both kinds are visible in one place
// and a keyword collision is obvious before it is saved.
commandsRouter.get('/', (_req, res) => {
  const builtIn = BUILT_IN_COMMANDS.map((entry, index) => ({
    id: -(index + 1),
    keyword: entry.keyword,
    label: entry.label,
    urlTemplate: null,
    position: -1,
    enabled: true,
    readonly: true,
  }))

  res.json({ rows: [...builtIn, ...listAllCommands()] })
})

commandsRouter.post('/', (req, res) => {
  res.status(201).json({ command: createCommand(createCommandSchema.parse(req.body)) })
})

commandsRouter.patch('/:id', (req, res) => {
  res.json({ command: updateCommand(idParam(req), updateCommandSchema.parse(req.body)) })
})

commandsRouter.put('/:id/enabled', (req, res) => {
  setCommandEnabled(idParam(req), enabledBody(req))
  res.json({ ok: true })
})

commandsRouter.put('/order', (req, res) => {
  reorderCommands(reorderSchema.parse(req.body).ids)
  res.json({ ok: true })
})

commandsRouter.delete('/:id', (req, res) => {
  deleteCommand(idParam(req))
  res.json({ ok: true })
})
