import { getDb } from '#db/index.js'
import { HTTP_PROVIDER } from './providers.js'

export interface HealthBinding {
  /** Ref of the entry this decorates, which may be a card, a saved site or a connector row */
  readonly ref: string
  /** `http`, or the type of the connector that answers */
  readonly provider: string
  readonly connectorId: number | null
  /** What the provider matches on; null leaves it to the provider's own fallback */
  readonly selector: string | null
}

interface BindingRow {
  ref: string
  provider: string
  connector_id: number | null
  selector: string | null
}

/**
 * Lists every binding, including ones whose target has since gone away. The resolver drops those
 * itself, because it is the only caller that knows which refs still exist.
 * @returns {ReadonlyArray<HealthBinding>} - Stored bindings
 */
export function listBindings(): ReadonlyArray<HealthBinding> {
  const rows = getDb()
    .prepare('SELECT ref, provider, connector_id, selector FROM health_bindings')
    .all() as BindingRow[]

  return rows.map(toRecord)
}

/**
 * Reads the binding of one entry.
 * @param {string} ref - Entry to look up
 * @returns {HealthBinding | undefined} - The binding, or undefined when the entry has none
 */
export function readBinding(ref: string): HealthBinding | undefined {
  const row = getDb()
    .prepare('SELECT ref, provider, connector_id, selector FROM health_bindings WHERE ref = ?')
    .get(ref) as BindingRow | undefined

  return row ? toRecord(row) : undefined
}

/**
 * Stores the binding of one entry, replacing whatever it had. One provider per entry is the
 * table's primary key rather than a rule enforced here.
 * @param {HealthBinding} binding - Binding to store
 * @returns {void}
 */
export function writeBinding(binding: HealthBinding): void {
  getDb()
    .prepare(
      `INSERT INTO health_bindings (ref, provider, connector_id, selector)
       VALUES (@ref, @provider, @connectorId, @selector)
       ON CONFLICT (ref) DO UPDATE SET
         provider = excluded.provider, connector_id = excluded.connector_id,
         selector = excluded.selector, updated_at = datetime('now')`,
    )
    .run({
      ref: binding.ref,
      provider: binding.provider,
      connectorId: binding.provider === HTTP_PROVIDER ? null : binding.connectorId,
      selector: binding.selector,
    })
}

/**
 * Removes the binding of one entry, for one being unbound or deleted.
 * @param {string} ref - Entry to unbind
 * @returns {void}
 */
export function clearBinding(ref: string): void {
  getDb().prepare('DELETE FROM health_bindings WHERE ref = ?').run(ref)
}

/**
 * Maps a stored row onto the shape the rest of the module reads.
 * @param {BindingRow} row - Row as sqlite returned it
 * @returns {HealthBinding} - The binding
 */
function toRecord(row: BindingRow): HealthBinding {
  return {
    ref: row.ref,
    provider: row.provider,
    connectorId: row.connector_id,
    selector: row.selector,
  }
}
