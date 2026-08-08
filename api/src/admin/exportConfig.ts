import { getDb } from '#db/index.js'
import { exportSecrets } from '#secrets/repository.js'
import { VERSION } from './transferVersion.js'

export interface ExportPayload {
  readonly version: number
  readonly exportedAt: string
  readonly icons: ReadonlyArray<{ id: number; name: string; svg: string }>
  readonly cards: ReadonlyArray<Record<string, unknown>>
  readonly sites: ReadonlyArray<Record<string, unknown>>
  readonly engines: ReadonlyArray<Record<string, unknown>>
  readonly localhost: ReadonlyArray<Record<string, unknown>>
  readonly commands: ReadonlyArray<Record<string, unknown>>
  /** Config, and each connector's credentials still sealed under this deployment's key */
  readonly connectors: ReadonlyArray<Record<string, unknown>>
  readonly settings: Record<string, unknown>
}

/**
 * Collects everything the portal renders into one portable document, for backing up, seeding
 * a second deployment, or moving a configuration between them.
 *
 * Connector credentials ride along still encrypted, never in the clear. What opens them is
 * `DIELE_SECRET_KEYS`, which is not in the file and belongs to the deployment rather than the
 * export: an instance holding the same key restores a working connector, and one holding a
 * different key finds nothing it can open and restores the connector switched off. The file is
 * therefore no more use to whoever finds it than the ciphertext in the database is.
 * @returns {ExportPayload} - The whole configuration, credentials sealed
 */
export function buildExport(): ExportPayload {
  const db = getDb()

  const rows = (sql: string, ...params: unknown[]): Array<Record<string, unknown>> =>
    db.prepare(sql).all(...params) as Array<Record<string, unknown>>

  const links = (kind: string): Array<Record<string, unknown>> =>
    rows(
      `SELECT label, url, display, keywords, icon_id AS iconId, color, position, enabled
       FROM links WHERE kind = ? ORDER BY position, id`,
      kind,
    ).map((row) => ({
      ...row,
      keywords: JSON.parse(String(row.keywords ?? '[]')) as string[],
      enabled: row.enabled === 1,
    }))

  return {
    version: VERSION,
    exportedAt: new Date().toISOString(),
    icons: db.prepare('SELECT id, name, svg FROM icons ORDER BY id').all() as Array<{
      id: number
      name: string
      svg: string
    }>,
    cards: links('card'),
    sites: links('site'),
    engines: rows(
      `SELECT name, url_template AS urlTemplate, position, enabled
       FROM search_engines ORDER BY position, id`,
    ).map((row) => ({ ...row, enabled: row.enabled === 1 })),
    localhost: rows(
      'SELECT scheme, port, keywords, position, enabled FROM localhost_ports ORDER BY position, id',
    ).map((row) => ({
      ...row,
      keywords: JSON.parse(String(row.keywords ?? '[]')) as string[],
      enabled: row.enabled === 1,
    })),
    commands: rows(
      `SELECT keyword, label, url_template AS urlTemplate, position, enabled
       FROM slash_commands ORDER BY position, id`,
    ).map((row) => ({ ...row, enabled: row.enabled === 1 })),
    // `enabled` travels with the credentials rather than on its own: the import only restores it
    // for a connector whose credentials it could open, so one that arrives without them still
    // comes back off instead of spending every interval failing.
    connectors: rows(
      `SELECT id, type, label, config, sync_interval_s AS syncIntervalSeconds, position, enabled
       FROM connectors ORDER BY position, id`,
    ).map(({ id, ...row }) => ({
      ...row,
      enabled: row.enabled === 1,
      config: JSON.parse(String(row.config ?? '{}')) as Record<string, unknown>,
      secrets: exportSecrets(Number(id)),
    })),
    settings: Object.fromEntries(
      rows('SELECT key, value FROM settings').map((row) => [
        String(row.key),
        JSON.parse(String(row.value)) as unknown,
      ]),
    ),
  }
}
