import { Router } from 'express'
import { canAdmin } from '#auth/permissions.js'
import { unauthorized } from '#errors.js'
import { readHealth } from './cache.js'

export const healthRouter: Router = Router()

// Separate from /api/entries for the reason entries is separate from config: a reading changes
// on every refresh, and folding it in would bust that payload's etag and resend the entries with
// it on every poll.
//
// Signed in but not admin-gated: a dot is what everyone came for. What an admin gets on top is
// `detail`, which quotes the source and therefore names internal hosts and how they answer.
healthRouter.get('/', (req, res) => {
  if (!req.user) {
    throw unauthorized()
  }

  res.json(readHealth(canAdmin(req.user)))
})
