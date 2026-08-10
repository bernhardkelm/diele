import { z } from 'zod'
import { isBuiltInKeyword } from '#commands/repository.js'
import { isLinkRef, linkRef } from '#connectors/refs.js'
import { getDb } from '#db/index.js'
import { hexColor, httpUrl, queryTemplate } from '#fieldSchemas.js'
import { HTTP_PROVIDER } from '#health/providers.js'
import { sanitizeSvg } from '#icons/sanitize.js'
import { MAX_SVG_BYTES } from '#icons/schemas.js'
import { importSecrets } from '#secrets/repository.js'
import { MAX_SELECTOR_LENGTH } from './healthSelector.js'
import { VERSION } from './transferVersion.js'

// An imported file is checked exactly as hard as a typed one. It may have been edited by hand or
// come from somewhere else entirely, so every url is held to the same http(s) rule the forms
// enforce: these values end up in an href, and `javascript:` there is a script behind a click.
const iconSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1).max(60),
  svg: z.string().min(1).max(MAX_SVG_BYTES),
})

const linkSchema = z.object({
  // Absent on a v3 file and earlier, which numbered its rows on arrival. Carried from v4 on,
  // because a ref is built from it and the liveness bindings are keyed by ref.
  id: z.number().int().positive().optional(),
  label: z.string().trim().min(1).max(120),
  url: httpUrl,
  display: z.string().nullish(),
  keywords: z.array(z.string()).default([]),
  iconId: z.number().int().positive().nullish(),
  color: hexColor.nullish(),
  // Accepted and dropped: the column is gone, and a health binding is a decorator's business
  // rather than a column on the row it decorates. Refusing it would reject every older export.
  monitor: z.string().nullish(),
  position: z.number().int(),
  enabled: z.boolean().default(true),
})

const engineSchema = z.object({
  name: z.string().trim().min(1).max(60),
  urlTemplate: queryTemplate,
  position: z.number().int(),
  enabled: z.boolean().default(true),
})

const localhostSchema = z.object({
  scheme: z.enum(['http', 'https']),
  port: z.number().int().min(1).max(65535),
  keywords: z.array(z.string()).default([]),
  position: z.number().int(),
  enabled: z.boolean().default(true),
})

const commandSchema = z.object({
  // The portal's own keywords win over a custom command anyway, so one imported under a built-in
  // name would be dead weight the operator could not see or remove by name.
  keyword: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .refine((value) => !isBuiltInKeyword(value), 'is a built-in command'),
  label: z.string().nullish(),
  urlTemplate: queryTemplate,
  position: z.number().int(),
  enabled: z.boolean().default(true),
})

// Base64 rather than free text: these three are buffers on the way in, and a value that is not
// one is a file to refuse rather than a credential to try opening.
const base64 = z
  .string()
  .min(1)
  .max(8192)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'is not base64')

const secretSchema = z.object({
  key: z.string().trim().min(1).max(60),
  keyId: z.string().trim().min(1).max(60),
  iv: base64,
  tag: base64,
  ciphertext: base64,
})

// The invariant migration 003 documents and `writeBinding` upholds, enforced here too because an
// insert of its own goes around that writer. A file disagreeing has a binding whose provider and
// instance say different things, and the resolver would route it by the instance rather than the
// provider it names.
const healthBindingSchema = z
  .object({
    ref: z.string().trim().min(1).max(200),
    provider: z.string().trim().min(1).max(60),
    connectorId: z.number().int().positive().nullish(),
    selector: z.string().max(MAX_SELECTOR_LENGTH).nullish(),
  })
  .refine(
    (binding) =>
      (binding.provider === HTTP_PROVIDER) ===
      (binding.connectorId === null || binding.connectorId === undefined),
    { message: 'connector_id is set exactly when the provider is not the built-in probe' },
  )

const connectorSchema = z.object({
  id: z.number().int().positive().optional(),
  type: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  config: z.record(z.string(), z.unknown()).default({}),
  syncIntervalSeconds: z.number().int().positive().default(900),
  position: z.number().int(),
  // Absent on a v1 or v2 file, and on one exported by a deployment that had no key to seal with.
  secrets: z.array(secretSchema).default([]),
  enabled: z.boolean().default(false),
})

export const importSchema = z.object({
  // Every version this far applies, each older one simply carrying less: no connectors at v1, no
  // credentials at v2, no row ids or bindings at v3. One newer than this build knows is refused,
  // because whatever it added is exactly what this code would drop without noticing.
  version: z.number().int().min(1).max(VERSION),
  icons: z.array(iconSchema).default([]),
  connectors: z.array(connectorSchema).default([]),
  healthBindings: z.array(healthBindingSchema).default([]),
  cards: z.array(linkSchema).default([]),
  sites: z.array(linkSchema).default([]),
  engines: z.array(engineSchema).default([]),
  localhost: z.array(localhostSchema).default([]),
  commands: z.array(commandSchema).default([]),
  settings: z.record(z.string(), z.unknown()).default({}),
})

export type ImportPayload = z.infer<typeof importSchema>

/**
 * Replaces the whole configuration with an imported one, in a single transaction so a
 * rejected row cannot leave half a portal behind.
 *
 * Icons are re-sanitised rather than trusted: the file may have been edited or come from
 * somewhere else entirely, and it is about to be inlined into the portal's own page.
 *
 * A connector's credentials are restored only where this deployment's key can open them, which
 * is the same key that sealed them. Anywhere else they are dropped and the connector arrives
 * switched off, waiting for its token to be typed in.
 * @param {ImportPayload} payload - Validated document to apply
 * @returns {Record<string, number>} - How many rows of each kind were written
 */
export function applyImport(payload: ImportPayload): Record<string, number> {
  const db = getDb()

  const insertIcon = db.prepare('INSERT INTO icons (id, name, svg) VALUES (?, ?, ?)')
  // A null id is what sqlite assigns the next number for, so one statement covers a file that
  // carries its ids and an older one that does not.
  const insertLink = db.prepare(
    `INSERT INTO links (id, kind, label, url, display, keywords, icon_id, color, position, enabled)
     VALUES (@id, @kind, @label, @url, @display, @keywords, @iconId, @color, @position, @enabled)`,
  )
  const insertEngine = db.prepare(
    `INSERT INTO search_engines (name, url_template, position, enabled)
     VALUES (@name, @urlTemplate, @position, @enabled)`,
  )
  const insertPort = db.prepare(
    `INSERT INTO localhost_ports (scheme, port, keywords, position, enabled)
     VALUES (@scheme, @port, @keywords, @position, @enabled)`,
  )
  const insertCommand = db.prepare(
    `INSERT INTO slash_commands (keyword, label, url_template, position, enabled)
     VALUES (@keyword, @label, @urlTemplate, @position, @enabled)`,
  )
  const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
  // Inserted off whatever the file said, and switched on below only once its credentials are in.
  // A connector restored on without them would spend every interval failing.
  const insertConnector = db.prepare(
    `INSERT INTO connectors (id, type, label, config, sync_interval_s, position, enabled)
     VALUES (@id, @type, @label, @config, @interval, @position, 0)`,
  )
  const insertBinding = db.prepare(
    `INSERT INTO health_bindings (ref, provider, connector_id, selector)
     VALUES (@ref, @provider, @connectorId, @selector)`,
  )
  const enableConnector = db.prepare('UPDATE connectors SET enabled = 1 WHERE id = ?')
  // The scheduler reads its queue from this table, so a connector without a row is one it never
  // sees. `next_run_at` defaults to now, which makes an imported connector due immediately.
  const insertSync = db.prepare('INSERT INTO connector_sync (connector_id) VALUES (?)')

  db.transaction(() => {
    db.prepare('DELETE FROM links').run()
    db.prepare('DELETE FROM search_engines').run()
    db.prepare('DELETE FROM icons').run()
    db.prepare('DELETE FROM localhost_ports').run()
    db.prepare('DELETE FROM slash_commands').run()
    db.prepare('DELETE FROM settings').run()
    // Not covered by either delete around it: a binding on the built-in probe names no connector
    // to cascade from, and a ref is not a foreign key to the links table.
    db.prepare('DELETE FROM health_bindings').run()
    // Cascades to the credentials, the cached entries and the sync state, so nothing is left
    // holding a token for a connector the import replaced.
    db.prepare('DELETE FROM connectors').run()

    for (const icon of payload.icons) {
      insertIcon.run(icon.id, icon.name, sanitizeSvg(icon.svg))
    }

    const known = new Set(payload.icons.map((icon) => icon.id))

    // Refs the file actually brought, so a binding naming a card it did not carry is dropped
    // rather than restored pointing at nothing.
    const linkRefs = new Set<string>()

    for (const [kind, list] of [
      ['card', payload.cards],
      ['site', payload.sites],
    ] as const) {
      for (const link of list) {
        const { lastInsertRowid } = insertLink.run({
          id: link.id ?? null,
          kind,
          label: link.label,
          url: link.url,
          display: link.display ?? null,
          keywords: JSON.stringify(link.keywords),
          // a reference to an icon the file did not carry would violate the foreign key, and
          // losing a logo is better than losing the import
          iconId: link.iconId && known.has(link.iconId) ? link.iconId : null,
          color: link.color ?? null,
          position: link.position,
          enabled: link.enabled ? 1 : 0,
        })

        linkRefs.add(linkRef(kind, Number(lastInsertRowid)))
      }
    }

    for (const engine of payload.engines) {
      insertEngine.run({
        name: engine.name,
        urlTemplate: engine.urlTemplate,
        position: engine.position,
        enabled: engine.enabled ? 1 : 0,
      })
    }

    for (const port of payload.localhost) {
      insertPort.run({
        scheme: port.scheme,
        port: port.port,
        keywords: JSON.stringify(port.keywords),
        position: port.position,
        enabled: port.enabled ? 1 : 0,
      })
    }

    for (const command of payload.commands) {
      insertCommand.run({
        keyword: command.keyword,
        label: command.label ?? null,
        urlTemplate: command.urlTemplate,
        position: command.position,
        enabled: command.enabled ? 1 : 0,
      })
    }

    const connectorIds = new Set<number>()

    for (const connector of payload.connectors) {
      const { lastInsertRowid } = insertConnector.run({
        id: connector.id ?? null,
        type: connector.type,
        label: connector.label,
        config: JSON.stringify(connector.config),
        interval: connector.syncIntervalSeconds,
        position: connector.position,
      })

      const id = Number(lastInsertRowid)
      insertSync.run(id)
      connectorIds.add(id)

      const stored = importSecrets(id, connector.secrets)

      // Only once every credential the file carried actually opened. A connector missing one of
      // its tokens is a connector that fails, and it says more to arrive off than to arrive on
      // and go red on the first run.
      if (connector.enabled && stored === connector.secrets.length) {
        enableConnector.run(id)
      }
    }

    // After both, because a binding names a link by ref and a connector by id. A ref that is not
    // a link's is a connector-produced entry, which the file never carries: those are a sync
    // cache rather than configuration, so the binding waits for the first run to fill them in.
    for (const binding of payload.healthBindings) {
      const connectorId = binding.connectorId ?? null

      if (connectorId !== null && !connectorIds.has(connectorId)) {
        continue
      }

      if (isLinkRef(binding.ref) && !linkRefs.has(binding.ref)) {
        continue
      }

      insertBinding.run({
        ref: binding.ref,
        provider: binding.provider,
        connectorId,
        selector: binding.selector ?? null,
      })
    }

    for (const [key, value] of Object.entries(payload.settings)) {
      insertSetting.run(key, JSON.stringify(value))
    }
  })()

  return {
    icons: payload.icons.length,
    cards: payload.cards.length,
    sites: payload.sites.length,
    engines: payload.engines.length,
    localhost: payload.localhost.length,
    commands: payload.commands.length,
    connectors: payload.connectors.length,
    healthBindings: payload.healthBindings.length,
  }
}
