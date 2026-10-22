import type { KeptStatus } from '@/composables/historyState'
import { keptPages } from '@/features/settings/historyPages'
import type { ListAction } from '@/helpers/listActions'
import type {
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
  /** How many kept pages are listed, the rest behind a row listing the next page */
  readonly shown: number
  /** Lists the next page of kept pages */
  readonly showMore: () => void
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
 * Says where the pages an opted-in account keeps come from, which is whichever sources the portal
 * accepts.
 * @param {ApiHistoryState['sources']} sources - The portal's source switches
 * @returns {string} - The opt-in's detail line while it is on
 */
function keptFrom(sources: ApiHistoryState['sources']): string {
  if (sources.diele && sources.extension) {
    return 'pages opened from the portal, and those the diele extension sends once switched on there, are kept for you and offered back in its search'
  }

  if (sources.extension) {
    return 'pages the diele extension sends, once switched on there, are kept for you and offered back in its search'
  }

  return sources.diele
    ? 'pages opened from the portal are kept for you and offered back in its search'
    : 'on, though this portal accepts visits from nowhere yet, so nothing new is kept'
}

/**
 * Builds the opt-in switch, which says what is happening in the state it is in.
 * @param {HistoryControls} controls - State and the write that flips it
 * @returns {SettingsOption} - The switch
 */
function optIn(controls: HistoryControls): SettingsOption {
  const { enabled, sources } = controls.state

  // Opting out never deletes, so the off state says where what is kept can be forgotten instead.
  let detail =
    'nothing new is kept; what is already kept stays until you forget it below, one by one or all at once'
  if (enabled) {
    detail = keptFrom(sources)
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

  const keeping = controls.state.available && controls.state.enabled

  return {
    ...base,
    description: keeping
      ? `forgets the ${pages} kept for you`
      : `forgets the ${pages} still kept from before`,
    trail: String(count),
    confirm: 'press again to forget all',
  }
}

/**
 * Says what the section holds, which is pages from whichever sources the portal accepts.
 * @param {ApiHistoryState['sources']} sources - The portal's source switches
 * @returns {string} - The section's description while the portal offers history
 */
function describe(sources: ApiHistoryState['sources']): string {
  if (sources.diele && sources.extension) {
    return 'pages opened from the portal or sent by the diele extension, kept for you and offered back in its search'
  }

  if (sources.extension) {
    return 'pages sent by the diele extension, kept for you and offered back in its search'
  }

  return sources.diele
    ? 'pages opened from the portal, kept for you and offered back in its search'
    : 'pages kept for you and offered back in its search, though this portal accepts them from nowhere yet'
}

/**
 * Builds the section once the portal no longer offers history but still keeps pages for this
 * account: those pages alone, each forgettable, and the row forgetting all of them. There is
 * nothing left to opt into or to exclude, so neither is offered.
 * @param {HistoryControls} controls - What is kept, and the writes that forget it
 * @returns {SettingsSection} - The section
 */
function keptOnly(controls: HistoryControls): SettingsSection {
  return {
    id: 'history',
    label: 'History',
    description:
      'this portal no longer keeps history; what it kept for you stays until you forget it',
    keywords: ['history', 'visited', 'pages', 'visits', 'forget', 'privacy'],
    trail: 'off',
    options: [],
    rows: [
      clearAction(controls),
      keptPages(controls.kept, controls.shown, controls.remove, controls.showMore),
    ],
  }
}

/**
 * Builds the section holding this account's history: the opt-in, the domains it never keeps,
 * and every page it kept, each of which can be forgotten on its own or all at once.
 *
 * Opting out never deletes: what was kept stays listed, and stays deletable, until someone
 * deletes it. The same holds once the portal stops offering history at all, which leaves only the
 * kept pages.
 * @param {HistoryControls} controls - What is kept, and the writes that change it
 * @returns {SettingsSection} - The section
 */
export function historySection(controls: HistoryControls): SettingsSection {
  if (!controls.state.available) {
    return keptOnly(controls)
  }

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
    description: describe(controls.state.sources),
    keywords: [
      'history',
      'visited',
      'pages',
      'visits',
      'forget',
      'exclude',
      'domains',
      'privacy',
      'extension',
    ],
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
      keptPages(controls.kept, controls.shown, controls.remove, controls.showMore),
    ],
  }
}
