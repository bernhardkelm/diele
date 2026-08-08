import cookieParser from 'cookie-parser'
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { ZodError } from 'zod'
import { adminRouter } from './admin/routes.js'
import {
  attachSession,
  requireAdmin,
  requireSameOrigin,
  requireSession,
} from './auth/middleware.js'
import { authRouter } from './auth/routes.js'
import { configRouter } from './bootstrap/routes.js'
import { config } from './config.js'
import { entriesRouter } from './connectors/routes.js'
import { ApiError } from './errors.js'

/**
 * Builds the express app: session resolution and the deny-by-default gate run before any
 * router, so a route added later is protected without its author doing anything.
 * @returns {Express} - Configured app, not yet listening
 */
export function createApp(): Express {
  const app = express()

  // Off unless a deployment says otherwise. `req.ip` is the only key the login limiter has, and
  // trusting `X-Forwarded-For` with nothing in front lets a caller write it per request and walk
  // past both caps. A reverse proxy that sets the header sets TRUST_PROXY=1 to match.
  app.set('trust proxy', config.trustProxy)
  app.set('etag', 'strong')

  // An import carries every icon the portal holds, each capped at 64KB on its own, so the
  // document is legitimately far larger than any other request here. Without its own limit an
  // export of a well-stocked portal cannot be read back in.
  app.use('/api/admin/import', express.json({ limit: '32mb' }))
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())

  app.get('/status', (_req, res) => {
    res.json({ status: 'ok' })
  })

  // Every payload below belongs to one account: the entries carry that person's hidden list, and
  // an error string is redacted for everyone but an admin. `private` keeps a shared cache from
  // holding a copy, `no-cache` keeps the etag revalidation the client already does rather than
  // letting a heuristic serve a stale portal.
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'private, no-cache')
    res.vary('Cookie')
    next()
  })

  app.use(attachSession())
  app.use(requireSameOrigin())
  app.use(requireSession())

  app.use('/api/auth', authRouter)
  app.use('/api/config', configRouter)
  app.use('/api/entries', entriesRouter)
  // requireAdmin on top of the global session gate: the client's mode switch is a
  // convenience, and a request that gets here has to stand on its own.
  app.use('/api/admin', requireAdmin(), adminRouter)

  app.use((_req, res) => {
    res.status(404).json({ error: 'not found' })
  })

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: err.message })
      return
    }

    if (err instanceof ZodError) {
      res.status(400).json({ error: 'invalid request', details: err.issues })
      return
    }

    // Body parser errors carry their own status, and 413 in particular is something the caller
    // can act on. Reporting it as 500 tells an operator their instance is broken when what
    // happened is that they sent more than it accepts.
    const status = (err as { status?: number; statusCode?: number }).status
    const statusCode = status ?? (err as { statusCode?: number }).statusCode

    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      res.status(statusCode).json({ error: (err as Error).message ?? 'bad request' })
      return
    }

    console.error('Unhandled error:', err)
    res.status(500).json({ error: 'internal server error' })
  })

  return app
}
