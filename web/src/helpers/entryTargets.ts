import type { ApiEntry } from '@diele/common'
import type { CardTarget, PortalTarget, RowTarget, SuggestionTarget } from '@/types/portal'

/**
 * Maps a connector-produced entry onto the target the launcher renders. The kind decides which
 * shape it becomes, so nothing here knows which connector produced it and a second forge needs
 * no case of its own.
 * @param {ApiEntry} entry - Entry as the API serves it
 * @returns {PortalTarget} - Target for the launcher
 */
export function toEntryTarget(entry: ApiEntry): PortalTarget {
  const base = {
    ref: entry.ref,
    name: entry.label,
    url: entry.url,
    keywords: entry.keywords,
    ...(entry.searchOnly ? { searchOnly: true as const } : {}),
    ...(entry.actions?.length ? { actions: entry.actions } : {}),
  }

  if (entry.kind === 'card') {
    // A produced card carries no icon of its own yet, so it renders as a wordmark tile.
    return { ...base, kind: 'card', icon: '', color: 'currentColor' } satisfies CardTarget
  }

  if (entry.kind === 'suggestion') {
    return {
      ...base,
      kind: 'suggestion',
      ...(entry.detail ? { display: entry.detail } : {}),
    } satisfies SuggestionTarget
  }

  return {
    ...base,
    kind: 'row',
    connectorId: entry.connectorId,
    ...(entry.detail ? { detail: entry.detail } : {}),
    ...(entry.timestamp ? { timestamp: entry.timestamp } : {}),
    ...(entry.parentRef ? { parentRef: entry.parentRef } : {}),
  } satisfies RowTarget
}
