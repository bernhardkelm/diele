import { dynamicSiteLink } from '@/features/portal/dynamicTarget'
import type { ApiCommand } from '@diele/common'
import type { CommandTarget, SuggestionTarget } from '@/types/portal'

/** Everything the launcher reaches through a slash. */
export type SlashTarget = CommandTarget | SuggestionTarget

export interface SlashInput {
  /** The word after the slash, lowercased */
  readonly keyword: string
  /** Whatever followed the first space, which is the term a command searches for */
  readonly args: string
  /** True once a space has been typed, so the keyword is settled and the rest is the term */
  readonly settled: boolean
}

// A keyword carries no slash of its own, which is what keeps `/r/vuejs` a subreddit jump
// rather than a command called `r/vuejs`.
const KEYWORD = /^[a-z0-9][a-z0-9._-]*$/i

/**
 * Reads a term written as a slash command. Anything that is not one — an ordinary search, a
 * pasted path, a subreddit — returns undefined, which is what leaves the rest of the launcher
 * untouched.
 * @param {string} term - Current search term
 * @returns {SlashInput | undefined} - The parsed command, or undefined
 */
export function parseSlash(term: string): SlashInput | undefined {
  const trimmed = term.trimStart()
  if (!trimmed.startsWith('/')) {
    return undefined
  }

  const rest = trimmed.slice(1)
  const space = rest.indexOf(' ')

  const keyword = (space === -1 ? rest : rest.slice(0, space)).toLowerCase()
  if (keyword.length > 0 && !KEYWORD.test(keyword)) {
    return undefined
  }

  return {
    keyword,
    args: space === -1 ? '' : rest.slice(space + 1).trim(),
    settled: space !== -1,
  }
}

/**
 * Builds the entry that opens a configured command's target for a term.
 * @param {ApiCommand} command - Command being run
 * @param {string} args - Term typed after the keyword
 * @returns {SuggestionTarget} - Search-only entry opening the resolved url
 */
export function commandTarget(command: ApiCommand, args: string): SuggestionTarget {
  return dynamicSiteLink({
    name: `${command.label ?? command.keyword}: ${args}`,
    url: command.urlTemplate.replace('{query}', encodeURIComponent(args)),
    display: hostOf(command.urlTemplate),
    // built from the typed term rather than saved, so opening it is worth recording
    adHoc: true,
  })
}

/**
 * Builds the menu entry for a command, which types its keyword and a space into the field so
 * the next keystroke is already the term.
 * @param {ApiCommand} command - Command to offer
 * @param {(term: string) => void} prefill - Puts a term in the search field
 * @returns {CommandTarget} - Entry that opens the command for typing
 */
export function commandMenuEntry(
  command: ApiCommand,
  prefill: (term: string) => void,
): CommandTarget {
  return {
    ref: command.ref,
    kind: 'command',
    name: `/${command.keyword}`,
    url: '',
    hint: command.label ? `searches ${command.label}` : `searches ${hostOf(command.urlTemplate)}`,
    keywords: [command.keyword, command.label ?? ''],
    searchOnly: true,
    keepsQuery: true,
    run: () => prefill(`/${command.keyword} `),
  }
}

/**
 * Reads the host out of a template, for the second column of an entry.
 * @param {string} template - Query url with its placeholder
 * @returns {string} - Host, or the template itself when it will not parse
 */
function hostOf(template: string): string {
  try {
    return new URL(template.replace('{query}', 'x')).host.replace(/^www\./, '')
  } catch {
    return template
  }
}
