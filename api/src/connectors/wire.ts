import type { ApiEntry, EntryKind } from '@diele/common'
import type { EntryRecord } from './entries.js'

const KINDS: ReadonlySet<string> = new Set(['card', 'row', 'suggestion'])

/**
 * Maps a stored entry onto the wire. Rows whose kind the frontend does not draw are dropped
 * rather than served, so a connector cannot make the page render nothing.
 * @param {EntryRecord} record - Entry as the repository read it
 * @returns {ApiEntry | undefined} - Entry for the client, or undefined when it cannot be drawn
 */
export function toApiEntry(record: EntryRecord): ApiEntry | undefined {
  if (!KINDS.has(record.kind)) {
    return undefined
  }

  return {
    ref: record.ref,
    connectorId: record.connectorId,
    connectorType: record.connectorType,
    kind: record.kind as EntryKind,
    label: record.label,
    detail: record.detail,
    url: record.url,
    keywords: record.keywords,
    actions: record.actions,
    timestamp: record.timestamp,
    parentRef: record.parentRef,
    searchOnly: record.searchOnly,
  }
}
