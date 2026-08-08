import type { ApiConfig } from '@diele/common'
import { Router } from 'express'
import { listCommands } from '#commands/repository.js'
import { config } from '#config.js'
import { listEngines } from '#engines/repository.js'
import { listLinks } from '#links/repository.js'
import { listLocalhost } from '#localhost/repository.js'
import { readSettings } from '#settings/repository.js'
import { isEnabled } from '#settings/toggles.js'

export const configRouter: Router = Router()

// Everything the portal needs to paint, in one request: it is a new tab page, so a second
// round trip is a second chance to be slow. Conditional requests are handled by express'
// own etag, which turns an unchanged payload into a 304.
configRouter.get('/', (_req, res) => {
  const payload: ApiConfig = {
    brand: config.brand,
    cards: isEnabled('cards') ? listLinks('card') : [],
    sites: isEnabled('sites') ? listLinks('site') : [],
    engines: isEnabled('engines') ? listEngines() : [],
    commands: listCommands(),
    localhost: isEnabled('localhost') ? listLocalhost() : [],
    settings: readSettings(),
  }

  res.json(payload)
})
