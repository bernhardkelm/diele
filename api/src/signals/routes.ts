import { Router } from 'express'
import { z } from 'zod'
import { canAdmin } from '#auth/permissions.js'
import { unauthorized } from '#errors.js'
import { readSignals } from './cache.js'
import { setSilenced } from './silences.js'

export const signalsRouter: Router = Router()

const silenceSchema = z.object({
  id: z.string().trim().min(1).max(200),
  silenced: z.boolean(),
})

// Separate from /api/health rather than folded into it: the two carry their own switches, so one
// being off must not take the other's payload with it, and a reading is keyed by the entry it
// decorates while a signal belongs to no entry at all.
//
// Signed in but not admin-gated, for the reason a dot is not: something being wrong is what
// everyone in the house wants to know. What an admin gets on top is `detail`, which quotes the
// alert's annotations and therefore names the instance that fired it.
signalsRouter.get('/', (req, res) => {
  if (!req.user) {
    throw unauthorized()
  }

  res.json(readSignals(canAdmin(req.user), req.user.id))
})

// One action whose reach is read from who is asking, rather than a scope the caller names: an
// admin quietens a line for the portal and everyone else quietens it for themselves. Taking the
// scope from the body instead would let a member ask for the portal's and have to be refused.
signalsRouter.put('/silence', (req, res) => {
  if (!req.user) {
    throw unauthorized()
  }

  const { id, silenced } = silenceSchema.parse(req.body)

  setSilenced(id, req.user.id, canAdmin(req.user), silenced)

  res.json({ ok: true })
})
