import { githubModule } from './github/module.js'
import { gitlabModule } from './gitlab/module.js'
import type { Capability } from '@diele/common'
import type { ConnectorModule } from './types.js'

/**
 * Every connector this build knows how to run. This list is the allowlist for
 * `connectors.type`: the column carries no CHECK, because renaming one in sqlite means
 * rebuilding the table and adding a connector must never cost that.
 */
const MODULES: ReadonlyArray<ConnectorModule> = [gitlabModule, githubModule]

const BY_TYPE = new Map(MODULES.map((module) => [module.type, module]))

/**
 * Lists every registered connector, in the order the admin view shows them.
 * @returns {ReadonlyArray<ConnectorModule>} - Registered modules
 */
export function listModules(): ReadonlyArray<ConnectorModule> {
  return MODULES
}

/**
 * Looks up one connector by the type its rows carry.
 * @param {string} type - Type as stored on the row or named in the path
 * @returns {ConnectorModule | undefined} - The module, or undefined when nothing registers it
 */
export function moduleFor(type: string): ConnectorModule | undefined {
  return BY_TYPE.get(type)
}

/**
 * Returns what a connector can be asked to do, read from the methods it implements rather
 * than from a list it declares, so the two can never disagree.
 * @param {ConnectorModule} module - Module to describe
 * @returns {ReadonlyArray<Capability>} - Capabilities the runtime may call
 */
export function capabilitiesOf(module: ConnectorModule): ReadonlyArray<Capability> {
  const capabilities: Capability[] = []

  if (module.collect) {
    capabilities.push('entries')
  }
  if (module.resolveHealth) {
    capabilities.push('health')
  }
  if (module.readSignals) {
    capabilities.push('signals')
  }
  if (module.search) {
    capabilities.push('search')
  }

  return capabilities
}
