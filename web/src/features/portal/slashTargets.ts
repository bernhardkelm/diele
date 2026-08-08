import {
  commandMenuEntry,
  commandTarget,
  parseSlash,
  type SlashTarget,
} from '@/features/portal/slashCommands'
import { signOutCommand } from '@/features/portal/sessionCommands'
import type { ApiCommand } from '@diele/common'
import type { CommandTarget } from '@/types/portal'

export interface SlashContext {
  /** Commands configured in the admin view */
  readonly commands: ReadonlyArray<ApiCommand>
  readonly openAdmin: () => void
  readonly openSettings: () => void
  /** Whether the admin entry is offered at all, false for an account that may not configure */
  readonly offersAdmin: boolean
  readonly signOut: () => void
  /** Who is signed in, so `/logout` can name them */
  readonly userName: string | null
  readonly prefill: (term: string) => void
}

/** Built in because they act on the portal rather than search; none of them is configurable. */
const ADMIN = 'admin'
const SETTINGS = 'settings'
const LOGOUT = 'logout'

/**
 * Builds the entry that opens the admin panel.
 * @param {() => void} openAdmin - Navigates to the admin route
 * @returns {CommandTarget} - Entry for `/admin`
 */
function adminEntry(openAdmin: () => void): CommandTarget {
  return {
    ref: 'cmd:admin',
    kind: 'command',
    name: '/admin',
    url: '',
    hint: 'configure cards, saved sites, search engines and connectors',
    keywords: ['admin', 'configure', 'manage', 'setup'],
    searchOnly: true,
    run: openAdmin,
  }
}

/**
 * Builds the entry that opens the settings view.
 * @param {() => void} openSettings - Navigates to the settings route
 * @returns {CommandTarget} - Entry for `/settings`
 */
function settingsEntry(openSettings: () => void): CommandTarget {
  return {
    ref: 'cmd:settings',
    kind: 'command',
    name: '/settings',
    url: '',
    hint: 'theme, hidden repos and signing out',
    keywords: ['settings', 'theme', 'preferences', 'options', 'appearance'],
    searchOnly: true,
    run: openSettings,
  }
}

/**
 * Resolves a term written as a slash command into the entries it should show.
 *
 * Returns undefined when the term is not a slash command at all, which is what leaves an
 * ordinary search, a pasted url and a subreddit path working as they did.
 * @param {string} term - Current search term
 * @param {SlashContext} context - The configured commands and what the built-ins do
 * @returns {ReadonlyArray<SlashTarget> | undefined} - Entries to show, or undefined
 */
export function slashTargetsFor(
  term: string,
  context: SlashContext,
): ReadonlyArray<SlashTarget> | undefined {
  const parsed = parseSlash(term)
  if (!parsed) {
    return undefined
  }

  const { keyword, args, settled } = parsed
  const configured = context.commands.find((command) => command.keyword === keyword)

  // the keyword is settled once a space follows it, so the rest of the line is the term
  if (settled) {
    if (keyword === SETTINGS) {
      return [settingsEntry(context.openSettings)]
    }

    if (keyword === ADMIN && context.offersAdmin) {
      return [adminEntry(context.openAdmin)]
    }

    if (keyword === LOGOUT) {
      return [signOutCommand('/logout', { signOut: context.signOut, name: context.userName })]
    }

    if (!configured) {
      return []
    }

    // without a term there is nothing to search for yet, so the entry stands and waits
    return args
      ? [commandTarget(configured, args)]
      : [commandMenuEntry(configured, context.prefill)]
  }

  // still typing the keyword: offer everything it could still become
  if (keyword === ADMIN && context.offersAdmin) {
    return [adminEntry(context.openAdmin)]
  }

  const menu: SlashTarget[] = []

  if (context.offersAdmin && ADMIN.startsWith(keyword)) {
    menu.push(adminEntry(context.openAdmin))
  }

  if (LOGOUT.startsWith(keyword)) {
    menu.push(signOutCommand('/logout', { signOut: context.signOut, name: context.userName }))
  }

  if (SETTINGS.startsWith(keyword)) {
    menu.push(settingsEntry(context.openSettings))
  }

  for (const command of context.commands) {
    if (command.keyword.startsWith(keyword)) {
      menu.push(commandMenuEntry(command, context.prefill))
    }
  }

  return menu
}
