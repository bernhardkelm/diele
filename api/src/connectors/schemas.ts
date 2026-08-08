import type { ApiRow } from '@diele/common'
import { z } from 'zod'
import { config } from '#config.js'
import { badRequest, unavailable } from '#errors.js'
import { moduleFor } from './registry.js'
import type { ConnectorRecord } from './repository.js'
import type { ConnectorModule } from './types.js'

/** An hour is long enough to be polite to a source, a minute short enough to test with. */
const MIN_INTERVAL_S = 60
const MAX_INTERVAL_S = 24 * 60 * 60

const labelSchema = z.string().trim().min(1).max(80)
const intervalSchema = z.coerce.number().int().min(MIN_INTERVAL_S).max(MAX_INTERVAL_S)

export interface SplitConnectorBody {
  readonly label?: string
  readonly syncIntervalSeconds?: number
  /** Only the module's own non-secret fields, still to be run through its parseConfig */
  readonly config: Record<string, unknown>
  /** Credentials to seal; an absent or empty one is left as it stands */
  readonly secrets: Record<string, string>
}

/**
 * Returns the module a request names, refusing a type this build does not register.
 * @param {string} type - Type as it arrived in the path
 * @returns {ConnectorModule} - The registered module
 */
export function requireModule(type: string): ConnectorModule {
  const module = moduleFor(type)
  if (!module) {
    throw badRequest(`unknown connector type "${type}"`)
  }

  return module
}

/**
 * Splits the flat row the admin form submits into the three places it belongs: the connector's
 * own columns, its config, and its credentials.
 *
 * Keys are taken from the module rather than from the body, so a field the module dropped
 * cannot keep writing to the config and a value cannot be smuggled into the secret store under
 * a name nothing declares.
 * @param {ConnectorModule} module - Module whose fields describe the row
 * @param {unknown} body - Request body as it arrived
 * @returns {SplitConnectorBody} - The body sorted into columns, config and credentials
 */
export function splitConnectorBody(module: ConnectorModule, body: unknown): SplitConnectorBody {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('body must be an object')
  }

  const source = body as Record<string, unknown>
  const secretKeys = new Set(module.secretKeys)

  // Not named `config`: that would shadow the app config this needs to read the keyring from,
  // and `config.secrets` would then quietly mean the wrong thing.
  const values: Record<string, unknown> = {}
  const secrets: Record<string, string> = {}

  for (const field of module.fields) {
    if (!(field.key in source)) {
      continue
    }

    const value = source[field.key]

    if (secretKeys.has(field.key)) {
      // The form never shows a stored credential, so it submits an empty box for one that is
      // already set. Empty therefore means "leave it alone" rather than "clear it".
      if (typeof value === 'string' && value.trim().length > 0) {
        // Refused here rather than at the cipher, which would surface as a 500 with nothing in
        // it saying the deployment is missing a key.
        if (!config.secrets.available) {
          throw unavailable(
            'DIELE_SECRET_KEYS is unset or unreadable, so credentials cannot be stored',
          )
        }

        secrets[field.key] = value.trim()
      }
      continue
    }

    // A field left empty is not a value of its own: dropping it is what lets the module's own
    // `.default()` stand, so the placeholder a form advertises is what actually gets stored.
    // `false` and `0` are values, so only null, undefined and the empty string are dropped.
    if (value === null || value === undefined || value === '') {
      continue
    }

    values[field.key] = value
  }

  const interval = source.syncIntervalSeconds

  return {
    ...('label' in source ? { label: labelSchema.parse(source.label) } : {}),
    ...(interval === null || interval === undefined || interval === ''
      ? {}
      : { syncIntervalSeconds: intervalSchema.parse(interval) }),
    config: values,
    secrets,
  }
}

/**
 * Refuses a create that leaves a required credential unset, so a connector cannot be stored in
 * a state where every sync is going to fail for a reason nothing recorded yet.
 * @param {ConnectorModule} module - Module whose fields describe the row
 * @param {Record<string, string>} secrets - Credentials the request carried
 * @returns {void}
 */
export function requireSecrets(module: ConnectorModule, secrets: Record<string, string>): void {
  for (const field of module.fields) {
    if (module.secretKeys.includes(field.key) && field.required && !secrets[field.key]) {
      throw badRequest(`${field.label} is required`)
    }
  }
}

/**
 * One connector as the admin list renders it: flat, and carrying no credential value. Narrows
 * the wire row, because a connector is always switchable where a built-in row need not be.
 */
export type AdminConnectorRow = ApiRow & { enabled: boolean }

/**
 * Flattens a connector onto the row shape the admin view edits, spreading its config back out
 * as the fields it was entered as and replacing each credential with whether it is set.
 * @param {ConnectorRecord} record - Connector as the repository read it
 * @param {ConnectorModule} module - Module whose fields describe the row
 * @returns {AdminConnectorRow} - Row for the admin list
 */
export function toAdminRow(record: ConnectorRecord, module: ConnectorModule): AdminConnectorRow {
  const row: AdminConnectorRow = {
    id: record.id,
    enabled: record.enabled,
    label: record.label,
    syncIntervalSeconds: record.syncIntervalSeconds,
    sync: record.sync,
  }

  for (const field of module.fields) {
    row[field.key] = module.secretKeys.includes(field.key)
      ? record.secrets[field.key]?.set === true
      : (record.config[field.key] ?? null)
  }

  return row
}
