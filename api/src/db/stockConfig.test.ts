import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { queryTemplate } from '#fieldSchemas.js'
import { isBuiltInKeyword } from '#commands/repository.js'
import { STOCK_COMMANDS, STOCK_ENGINES, STOCK_PORTS } from './stockConfig.js'

interface SeedFile {
  engines: Array<{ name: string; urlTemplate: string; position: number; enabled: boolean }>
  commands: Array<{
    keyword: string
    label: string
    urlTemplate: string
    position: number
    enabled: boolean
  }>
  localhost: Array<{
    scheme: string
    port: number
    keywords: string[]
    position: number
    enabled: boolean
  }>
}

// One level up from this module either way: `src/` while tsx runs it, `dist/` once built.
const seedPath = resolve(import.meta.dirname, '../..', 'example-seed.json')
const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as SeedFile

/** What the seeder spaces positions by, so the file has to agree row for row. */
const POSITION_STEP = 10

// An import replaces the configuration rather than adding to it, so the example file has to carry
// the stock rows itself: without them, importing it leaves a portal that cannot search. That makes
// two places saying the same thing, and this is what keeps them saying it.
test('the example seed carries the same engines the stock config does', () => {
  assert.deepEqual(
    seed.engines,
    STOCK_ENGINES.map((engine, index) => ({
      name: engine.name,
      urlTemplate: engine.urlTemplate,
      position: (index + 1) * POSITION_STEP,
      enabled: engine.enabled,
    })),
  )
})

test('the example seed carries the same commands the stock config does', () => {
  assert.deepEqual(
    seed.commands,
    STOCK_COMMANDS.map((command, index) => ({
      keyword: command.keyword,
      label: command.label,
      urlTemplate: command.urlTemplate,
      position: (index + 1) * POSITION_STEP,
      enabled: command.enabled,
    })),
  )
})

test('the example seed carries the same local ports the stock config does', () => {
  assert.deepEqual(
    seed.localhost,
    STOCK_PORTS.map((port, index) => ({
      scheme: port.scheme,
      port: port.port,
      keywords: [...port.keywords],
      position: (index + 1) * POSITION_STEP,
      enabled: true,
    })),
  )
})

// The rows go in under the schema's own constraints rather than through the routes, so nothing
// else would refuse a template that the admin form would have.
test('every stock template is one the admin form would accept', () => {
  for (const { name, urlTemplate } of STOCK_ENGINES) {
    assert.doesNotThrow(() => queryTemplate.parse(urlTemplate), name)
  }

  for (const { keyword, urlTemplate } of STOCK_COMMANDS) {
    assert.doesNotThrow(() => queryTemplate.parse(urlTemplate), keyword)
  }
})

// A row redefining one of these would be refused if it were typed in, and would shadow the only
// way to reach the admin panel if it were not.
test('no stock command redefines one the portal answers to itself', () => {
  for (const { keyword } of STOCK_COMMANDS) {
    assert.equal(isBuiltInKeyword(keyword), false, `/${keyword} is built in`)
  }
})

test('no stock command or engine is defined twice', () => {
  assert.equal(
    new Set(STOCK_COMMANDS.map((command) => command.keyword)).size,
    STOCK_COMMANDS.length,
  )
  assert.equal(new Set(STOCK_ENGINES.map((engine) => engine.name)).size, STOCK_ENGINES.length)
  assert.equal(
    new Set(STOCK_PORTS.map((port) => `${port.scheme}:${port.port}`)).size,
    STOCK_PORTS.length,
  )
})
