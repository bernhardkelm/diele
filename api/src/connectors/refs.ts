/**
 * Stable identity for everything the launcher can reach. The client keys its render, its
 * health map and its launch history on these, so they have to outlive a rename: a card keeps
 * its row id and a repo keeps the provider's numeric id, neither of which moves when the
 * label or the url does.
 *
 * The server sends every ref and the client derives none. The two repos mirror their wire
 * types by hand, and a format that drifted on one side would surface as silently missing dots
 * rather than as a type error.
 */

/**
 * Returns the ref of a card or saved site.
 * @param {'card' | 'site'} kind - Which section the link belongs to
 * @param {number} id - Row id in `links`
 * @returns {string} - Ref for the link
 */
export function linkRef(kind: 'card' | 'site', id: number): string {
  return `${kind}:${id}`
}

/**
 * Returns the ref of a local port.
 * @param {number} id - Row id in `localhost_ports`
 * @returns {string} - Ref for the port
 */
export function portRef(id: number): string {
  return `port:${id}`
}

/**
 * Returns the ref of a slash command.
 * @param {number} id - Row id in `slash_commands`
 * @returns {string} - Ref for the command
 */
export function commandRef(id: number): string {
  return `cmd:${id}`
}

/**
 * Returns the ref of a connector-produced entry, qualified by the instance that produced it so
 * two GitLab connectors cannot collide on the same repo id.
 * @param {string} type - Connector type, e.g. `gitlab`
 * @param {number} connectorId - Row id in `connectors`
 * @param {string} localRef - Identity the module assigned within itself
 * @returns {string} - Ref for the entry
 */
export function entryRef(type: string, connectorId: number, localRef: string): string {
  return `${type}:${connectorId}:${localRef}`
}
