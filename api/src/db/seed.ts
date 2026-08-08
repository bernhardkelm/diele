import type { Database } from 'better-sqlite3'
import { config } from '#config.js'
import { STOCK_COMMANDS, STOCK_ENGINES, STOCK_PORTS } from './stockConfig.js'

/** Spaced the way every other row is, so moving one between two others is a single update. */
const POSITION_STEP = 10

/**
 * Fills a database that has just been created with the configuration that is the same for
 * everyone: what `↵` searches, the slash commands, and the ports a development machine runs
 * things on.
 *
 * Cards and saved sites are deliberately absent. Every one of those would be a guess at an
 * address only this deployment knows, which is the thing an empty database was protecting;
 * `example-seed.json` carries them for whoever wants a portal with something in it to look at.
 *
 * Called from the first migration, which is the only place that already knows the database did
 * not exist a moment ago: a later one would run on every install and put back rows someone had
 * deliberately deleted.
 * @param {Database} db - Database whose schema has just been created
 * @returns {void}
 */
export function seedStockConfig(db: Database): void {
  if (!config.seedStockConfig) {
    return
  }

  const insertEngine = db.prepare(
    `INSERT INTO search_engines (name, url_template, position, enabled)
     VALUES (@name, @urlTemplate, @position, @enabled)`,
  )
  const insertCommand = db.prepare(
    `INSERT INTO slash_commands (keyword, label, url_template, position, enabled)
     VALUES (@keyword, @label, @urlTemplate, @position, @enabled)`,
  )
  const insertPort = db.prepare(
    `INSERT INTO localhost_ports (scheme, port, keywords, position, enabled)
     VALUES (@scheme, @port, @keywords, @position, 1)`,
  )

  STOCK_ENGINES.forEach((engine, index) => {
    insertEngine.run({
      name: engine.name,
      urlTemplate: engine.urlTemplate,
      position: (index + 1) * POSITION_STEP,
      enabled: engine.enabled ? 1 : 0,
    })
  })

  STOCK_COMMANDS.forEach((command, index) => {
    insertCommand.run({
      keyword: command.keyword,
      label: command.label,
      urlTemplate: command.urlTemplate,
      position: (index + 1) * POSITION_STEP,
      enabled: command.enabled ? 1 : 0,
    })
  })

  STOCK_PORTS.forEach((port, index) => {
    insertPort.run({
      scheme: port.scheme,
      port: port.port,
      keywords: JSON.stringify(port.keywords),
      position: (index + 1) * POSITION_STEP,
    })
  })
}
