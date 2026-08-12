import { Router, type Request, type Response } from 'express'
import { config } from '#config.js'
import { buildFavicons } from './assets.js'

/** Long enough to spare the request on every navigation, short enough that a new accent lands. */
const MAX_AGE_SECONDS = 60 * 60

/**
 * Serves the icon set this deployment's accent was drawn into.
 *
 * Built once at boot: the accent comes from the environment, so it cannot change while this
 * process runs, and drawing half a megabyte of pixels per request for a file a browser asks for
 * on every cold navigation would be work with no result to show for it.
 *
 * Mounted ahead of the built app, whose directory carries a stock set of the same names. That
 * set answers only where this router is not in front of it: a build predating it, or `web/dist`
 * served by something other than this process. The vite dev server proxies `/favicon` here, so a
 * checkout shows the accent it is configured with rather than the stock one.
 * @returns {Router} - Express router, before the static files
 */
export function createFaviconRouter(): Router {
  const router = Router()
  const assets = buildFavicons(config.brand)

  router.get('/favicon/:file', (req: Request, res: Response, next) => {
    const asset = assets.get(req.path)
    if (!asset) {
      next()
      return
    }

    res.set('Cache-Control', `public, max-age=${MAX_AGE_SECONDS}`)
    res.type(asset.type).send(asset.body)
  })

  return router
}
