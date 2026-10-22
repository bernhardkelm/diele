import type { KeptStatus } from '@/composables/useHistory'
import { toHistoryTarget } from '@/features/portal/historyTargets'
import type { ListAction } from '@/helpers/listActions'
import { formatRelativeTime } from '@/helpers/relativeTime'
import type {
  SettingsItem,
  SettingsOption,
  SettingsRow,
  SettingsSection,
} from '@/features/settings/settingsSections'
import type { ApiHistoryEntry, ApiHistoryState } from '@diele/common'

export interface HistoryControls {
  readonly state: ApiHistoryState
  /** Every page kept for this account, most recent first */
  readonly kept: ReadonlyArray<ApiHistoryEntry>
  readonly keptStatus: KeptStatus
  /** Opts this account in or out; opting out keeps what is already there */
  readonly setEnabled: (enabled: boolean) => void
  /** Adds an excluded domain, answering with why it was refused, or undefined once it is added */
  readonly exclude: (input: string) => Promise<string | undefined>
  /** Takes a domain off the excluded list */
  readonly include: (domain: string) => Promise<void>
  /** Forgets one kept page */
  readonly remove: (id: number) => Promise<void>
  /** Forgets every kept page */
  readonly clear: () => Promise<void>
}

/**
 * Builds the opt-in switch, which says what is happening in the state it is in.
 * @param {HistoryControls} controls - State and the write that flips it
 * @returns {SettingsOption} - The switch
 */
function optIn(controls: HistoryControls): SettingsOption {
  const { enabled, sources } = controls.state
  const accepted = sources.diele || sources.extension

  // Opting out never deletes, so the off state says where what is kept can be forgotten instead.
  let detail =
    'nothing new is kept; what is already kept stays until you forget it below, one by one or all at once'
  if (enabled) {
    detail = accepted
      ? 'pages opened from the portal are kept for you and offered back in its search'
      : 'on, though this portal accepts visits from nowhere yet, so nothing new is kept'
  }

  return {
    id: 'enabled',
    label: 'Keep visited pages',
    detail,
    on: enabled,
    run: () => controls.setEnabled(!enabled),
  }
}

/**
 * Builds the row that forgets everything at once. It stands whether or not anything is kept,
 * because it is also where the section says so.
 * @param {HistoryControls} controls - What is kept and the write that clears it
 * @returns {ListAction} - The clearing row
 */
function clearAction(controls: HistoryControls): ListAction {
  const count = controls.kept.length
  const pages = `${count} page${count === 1 ? '' : 's'}`

  const base = {
    kind: 'action' as const,
    id: 'clear-history',
    label: 'Forget every page',
    run: () => void controls.clear(),
  }

  if (controls.keptStatus === 'failed') {
    return { ...base, description: 'could not read what is kept, try again later', disabled: true }
  }

  if (controls.keptStatus !== 'read') {
    return { ...base, description: 'reading what is kept', disabled: true }
  }

  if (count === 0) {
    return { ...base, description: 'nothing is kept for you', disabled: true }
  }

  return {
    ...base,
    description: controls.state.enabled
      ? `forgets the ${pages} kept for you`
      : `forgets the ${pages} still kept from before`,
    trail: String(count),
    confirm: 'press again to forget all',
  }
}

/**
 * Builds the row of one kept page.
 * @param {ApiHistoryEntry} entry - Page as the api served it
 * @param {(id: number) => Promise<void>} remove - Forgets it
 * @returns {SettingsItem} - Its row
 */
function pageItem(entry: ApiHistoryEntry, remove: (id: number) => Promise<void>): SettingsItem {
  const page = toHistoryTarget(entry)
  const visits = `${entry.visits} visit${entry.visits === 1 ? '' : 's'}`

  return {
    kind: 'item',
    id: `page:${entry.id}`,
    label: page.name,
    detail: page.title ? `${page.display} · ${visits}` : visits,
    note: formatRelativeTime(entry.lastVisitedAt),
    removeTitle: `Forget ${page.name}`,
    confirm: true,
    remove: () => remove(entry.id),
  }
}

/**
 * Builds the section holding this account's history: the opt-in, the domains it never keeps,
 * and every page it kept, each of which can be forgotten on its own or all at once.
 *
 * Only built where the instance offers history at all. Opting out never deletes: what was kept
 * stays listed, and stays deletable, until someone deletes it.
 * @param {HistoryControls} controls - What is kept, and the writes that change it
 * @returns {SettingsSection} - The section
 */
export function historySection(controls: HistoryControls): SettingsSection {
  const domains: ReadonlyArray<SettingsRow> = controls.state.excludedDomains.map((domain) => ({
    kind: 'item',
    id: `domain:${domain}`,
    label: domain,
    detail: 'never kept, nor anything below it',
    removeTitle: `Stop excluding ${domain}`,
    remove: () => controls.include(domain),
  }))

  return {
    id: 'history',
    label: 'History',
    description: 'pages opened from the portal, kept for you and offered back in its search',
    keywords: ['history', 'visited', 'pages', 'visits', 'forget', 'exclude', 'domains', 'privacy'],
    trail: controls.state.enabled ? 'on' : 'off',
    options: [optIn(controls)],
    rows: [
      {
        kind: 'field',
        id: 'exclude',
        label: 'Exclude a domain',
        detail: 'never keeps a page on it, and forgets what is already kept there',
        inputLabel: 'domain',
        placeholder: 'example.com',
        submitLabel: 'Exclude',
        submit: controls.exclude,
      },
      ...domains,
      clearAction(controls),
      ...controls.kept.map((entry) => pageItem(entry, controls.remove)),
    ],
  }
}
