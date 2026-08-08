import { Router } from 'express'
import { z } from 'zod'
import { canAdmin } from '#auth/permissions.js'
import { forbidden, unauthorized } from '#errors.js'
import { listEntries } from './entries.js'
import { readHidden, setHidden } from './hidden.js'
import { listEnabledConnectors } from './repository.js'
import { moduleFor } from './registry.js'
import { isEnabled } from '#settings/toggles.js'
import type { ApiEntries, ApiEntriesSource } from '@diele/common'
import { toApiEntry } from './wire.js'

export const entriesRouter: Router = Router()

const hiddenSchema = z.object({
  ref: z.string().trim().min(1).max(200),
  scope: z.enum(['all', 'mine']),
  hidden: z.boolean(),
})

/**
 * Narrows a sync error to what its reader may see. An admin gets the message, since they are the
 * one who can act on it; anyone else is told only that the section is not current.
 * @param {string | null} error - Error the last run recorded, already stripped of credentials
 * @param {boolean} detailed - Whether the reader may see the message itself
 * @returns {string | null} - What to serve
 */
function errorFor(error: string | null, detailed: boolean): string | null {
  if (!error || detailed) {
    return error
  }

  return 'this source could not be reached on its last run'
}

// Separate from /api/config rather than folded into it: config changes only when a human edits
// something, so its strong etag turns a new tab into a 304 with an empty body. Entries change
// on every sync, and carrying them there would bust that etag and send the icons again with it.
//
// Not admin-gated, only signed in, so nothing here may carry a connector's configuration. The
// error string is redacted of stored credentials before it is written, not here, and the message
// itself is kept from non-admins by `errorFor`.
entriesRouter.get('/', (req, res) => {
  if (!req.user) {
    throw unauthorized()
  }

  // The detail is an admin's to read. A sync error quotes the source's own response, so on an
  // instance pointed at an internal address it says which hosts and ports answer and how - an
  // internal-network oracle for anyone with an account. Everyone else is told that a section is
  // stale, which is all they can act on anyway.
  const detailed = canAdmin(req.user)

  // A type switched off as a whole leaves the wire entirely, entries and source alike. The
  // stored rows stand untouched, so switching it back on needs no sync to fill the list again.
  const sources: ReadonlyArray<ApiEntriesSource> = listEnabledConnectors()
    .filter((connector) => isEnabled(connector.type))
    .map((connector) => ({
      connectorId: connector.id,
      type: connector.type,
      label: connector.label,
      mark: moduleFor(connector.type)?.mark ?? connector.type.slice(0, 2),
      syncedAt: connector.sync.lastOkAt,
      error: errorFor(connector.sync.lastError, detailed),
    }))

  // Every entry is served, hidden or not, and the client leaves the hidden ones out. Hiding is
  // a display preference rather than a permission - the lists that manage it have to show what
  // is hidden in order to bring it back, and an admin has to see what the portal is hiding from
  // everyone. Anything that must not be seen belongs behind the connector's own token.
  const payload: ApiEntries = {
    entries: listEntries()
      .filter((record) => isEnabled(record.connectorType))
      .map(toApiEntry)
      .filter((entry) => entry !== undefined),
    sources,
    hidden: readHidden(req.user.id),
  }

  res.json(payload)
})

entriesRouter.put('/hidden', (req, res) => {
  if (!req.user) {
    throw unauthorized()
  }

  const { ref, scope, hidden } = hiddenSchema.parse(req.body)

  // Checked here rather than on the router: hiding something for yourself is what anyone signed
  // in may do, and only hiding it for everyone is an administrative act.
  if (scope === 'all' && !canAdmin(req.user)) {
    throw forbidden('hiding an entry for everyone is not permitted for this account')
  }

  setHidden(ref, scope, req.user.id, hidden)

  res.json({ ok: true })
})
