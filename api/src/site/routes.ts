import { existsSync } from 'node:fs'
import { join } from 'node:path'
import express, { type NextFunction, type Request, type Response, Router } from 'express'

// Vite's `build.assetsDir`. Everything under it carries a content hash, so a changed file is a
// changed url and the old one may be held forever, which is true of nothing beside it.
const HASHED_DIR = 'assets'

const DOCUMENT_METHODS = new Set(['GET', 'HEAD'])

/**
 * Returns whether the api owns the answer rather than the built app.
 * @param {string} path - Request path, without query string
 * @returns {boolean} - True when the request must reach the routers below
 */
function isApiPath(path: string): boolean {
  return path === '/status' || path === '/api' || path.startsWith('/api/')
}

/**
 * Serves the built launcher, and answers a path it does not recognise with `index.html` so a
 * deep link opens the app rather than a 404.
 *
 * Returns a router that does nothing when the directory holds no build, which is the case in a
 * checkout nobody has run `npm run build` in.
 * @param {string} root - Directory holding the built launcher
 * @returns {Router} - Express router, mounted before the session gate
 */
export function createSiteRouter(root: string): Router {
  const router = Router()
  const indexPath = join(root, 'index.html')

  if (!existsSync(indexPath)) {
    return router
  }

  // Nothing a vite build emits lands under /api today, and this is what keeps a file dropped
  // there tomorrow from shadowing a route: the api answers those, not the directory.
  router.use((req: Request, _res: Response, next: NextFunction) => {
    if (isApiPath(req.path)) {
      next('router')
      return
    }

    next()
  })

  // `fallthrough: false` so a hashed file that is genuinely missing answers 404 rather than
  // reaching the fallback below and being served `index.html` under a javascript content type.
  router.use(
    `/${HASHED_DIR}`,
    express.static(join(root, HASHED_DIR), {
      immutable: true,
      maxAge: '1y',
      fallthrough: false,
      index: false,
    }),
  )

  // The favicons, which carry no hash and therefore have to revalidate.
  router.use(express.static(root, { index: false }))

  router.use((req: Request, res: Response, next: NextFunction) => {
    if (!DOCUMENT_METHODS.has(req.method)) {
      next()
      return
    }

    // Never cached: it names the hashed bundles, so a stale copy pins an open tab to the build
    // it was opened on.
    res.set('Cache-Control', 'no-cache')
    res.sendFile(indexPath, (error?: Error) => {
      if (error) {
        next(error)
      }
    })
  })

  return router
}
