import { getDb } from '#db/index.js'
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
  /** Config only; credentials are never in here and must stay out */
  readonly connectors: ReadonlyArray<Record<string, unknown>>
  readonly settings: Record<string, unknown>
}

/**
 * Collects everything the portal renders into one portable document, for backing up, seeding
 * a second deployment, or moving a configuration between them.
 *
 * Connector credentials are deliberately absent and must stay absent: an export is a file
 * that gets mailed around and committed, which is the last place a token belongs.
 * @returns {ExportPayload} - The whole configuration, without secrets
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
    // connector_secrets is deliberately not read here, and adding it would be the mistake this
    // whole file is written to avoid. `enabled` is not carried either: a connector arrives
    // without its credential, so it comes back off rather than failing on first sync.
    connectors: rows(
      `SELECT type, label, config, sync_interval_s AS syncIntervalSeconds, position
       FROM connectors ORDER BY position, id`,
    ).map((row) => ({
      ...row,
      config: JSON.parse(String(row.config ?? '{}')) as Record<string, unknown>,
    })),
    settings: Object.fromEntries(
      rows('SELECT key, value FROM settings').map((row) => [
        String(row.key),
        JSON.parse(String(row.value)) as unknown,
      ]),
    ),
  }
}
