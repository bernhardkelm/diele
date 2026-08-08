import type { ApiFeature, ApiRow } from '@diele/common'
import type { RowAction } from '@/features/admin/adminRowActions'
import type { CardTarget, CommandTarget, SuggestionTarget } from '@/types/portal'

// Specimens are fed to the real components rather than mimicked in markup, so this page cannot
// drift from what the portal actually renders. Anything wrong here is wrong in the portal too.
export const COMMANDS: ReadonlyArray<{ index: number; item: CommandTarget }> = [
  {
    index: 0,
    item: {
      ref: 'cmd:settings',
      kind: 'command',
      name: '/settings',
      url: '',
      hint: 'the detail column, which ellipsizes rather than wraps when it runs long',
      searchOnly: true,
      run: () => {},
    },
  },
  {
    index: 1,
    item: {
      ref: 'cmd:logout',
      kind: 'command',
      name: '/logout',
      url: '',
      hint: 'the highlighted row, which carries the marker at the start of the line',
      searchOnly: true,
      run: () => {},
    },
  },
]

export const SITES: ReadonlyArray<{ index: number; item: SuggestionTarget }> = [
  {
    index: 0,
    item: {
      ref: 'site:1',
      kind: 'suggestion',
      name: 'grafana',
      url: 'https://grafana.example.com',
      keywords: [],
      searchOnly: true,
    },
  },
  {
    index: 1,
    item: {
      ref: 'site:2',
      kind: 'suggestion',
      name: 'uptime',
      url: 'https://uptime.example.com',
      keywords: [],
      searchOnly: true,
    },
  },
]

// a square rather than a logo, so the card is shown without dragging an asset in for it
export const CARD: CardTarget = {
  ref: 'card:1',
  kind: 'card',
  name: 'Grafana',
  url: 'https://grafana.example.com',
  icon: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor"/></svg>',
  color: '#f46800',
}

export const FEATURE: ApiFeature = {
  id: 'styleguide',
  label: 'Specimen',
  description: '',
  kind: 'builtin',
  produces: ['row'],
  fields: [],
  count: 2,
  enabledCount: 1,
}

export const ENTRY_ROWS: ReadonlyArray<ApiRow> = [
  { id: 1, enabled: true, name: 'nested', url: 'one indent deeper, on the same tracks' },
  { id: 2, enabled: false, name: 'disabled', url: 'dimmed, and says so in the trail' },
]

export const ENTRY_ACTIONS: ReadonlyArray<RowAction> = [
  { id: 'edit', label: 'edit' },
  { id: 'toggle', label: 'off', tone: 'off' },
  { id: 'remove', label: 'del', tone: 'danger' },
]

export const SELECT_OPTIONS = [
  { value: 'https', label: 'https' },
  { value: 'http', label: 'http' },
]
