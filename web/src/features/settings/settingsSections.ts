import type { ListAction } from '@/helpers/listActions'
import { scoreFields } from '@/helpers/scoreFields'
import type { SearchField } from '@/helpers/searchFields'
import { tokenize, type SearchToken } from '@/helpers/searchTokens'

/**
 * One nested row of a section. A row says which way it is set and running it is all it does:
 * for most that is a switch flipping between two states, for one that names more than two it is
 * a step to the next.
 */
export interface SettingsOption {
  readonly id: string
  readonly label: string
  /** One line under the name, saying what the setting does in the state it is in */
  readonly detail: string
  readonly on: boolean
  /**
   * Word the trail carries instead of `on`/`off`, for a row stepping through more settings than
   * a switch can hold. Such a row is never dormant, so it is always `on` as well.
   */
  readonly value?: string
  readonly run: () => void
}

/**
 * One group of preferences, which expands in place the way an admin feature does. A section
 * owns its rows outright: they are read from and written to this browser, so opening one costs
 * no request and shows nothing that has to be waited for.
 */
export interface SettingsSection {
  readonly id: string
  readonly label: string
  readonly description: string
  /** Words the section answers to besides its own texts, so a term finds it by what it does */
  readonly keywords: ReadonlyArray<string>
  /** What the trail reports at rest, where an admin feature shows its counts */
  readonly trail: string
  readonly options: ReadonlyArray<SettingsOption>
  /** Row that acts rather than switching, ahead of the options the way `Add entry` is */
  readonly action?: ListAction
}

/**
 * Returns the texts a section is searched over, each weighted by how much a hit on it says.
 * @param {SettingsSection} section - Section to describe
 * @returns {ReadonlyArray<SearchField>} - Weighted fields, the label first
 */
function sectionFields(section: SettingsSection): ReadonlyArray<SearchField> {
  return [
    { text: section.label, weight: 1 },
    { text: section.id, weight: 0.9 },
    { text: section.keywords.join(' '), weight: 0.7 },
    { text: section.description, weight: 0.5 },
  ]
}

/**
 * Returns the texts an option is searched over.
 * @param {SettingsOption} option - Option to describe
 * @returns {ReadonlyArray<SearchField>} - Weighted fields, the label first
 */
function optionFields(option: SettingsOption): ReadonlyArray<SearchField> {
  return [
    { text: option.label, weight: 1 },
    { text: option.detail, weight: 0.5 },
  ]
}

/**
 * Filters and ranks the options a term addresses, in their declared order: a section's rows
 * are a fixed set someone reads down, not a result list to be reordered under them.
 * @param {ReadonlyArray<SettingsOption>} options - Rows of one section
 * @param {ReadonlyArray<SearchToken>} tokens - Tokens the query split into
 * @returns {ReadonlyArray<SettingsOption>} - Matching options, in section order
 */
function filterOptions(
  options: ReadonlyArray<SettingsOption>,
  tokens: ReadonlyArray<SearchToken>,
): ReadonlyArray<SettingsOption> {
  return options.filter((option) => scoreFields(optionFields(option), tokens) !== undefined)
}

/**
 * Filters and ranks the sections a term addresses.
 *
 * The open section keeps its place whether or not the term hits it, and the term narrows what
 * is inside it instead: a repo name typed with the repos open finds that repo, which is the
 * whole point of a section long enough to need searching. Everything else is ranked the way
 * the admin features are.
 * @param {ReadonlyArray<SettingsSection>} sections - Every section the view offers
 * @param {string} query - Raw search term as typed
 * @param {string | undefined} expanded - Section whose rows are on screen
 * @returns {ReadonlyArray<SettingsSection>} - Matching sections, best first, source order when the term is empty
 */
export function searchSections(
  sections: ReadonlyArray<SettingsSection>,
  query: string,
  expanded: string | undefined,
): ReadonlyArray<SettingsSection> {
  const tokens = tokenize(query)
  if (tokens.length === 0) {
    return sections
  }

  const ranked: Array<{ section: SettingsSection; score: number; order: number }> = []

  sections.forEach((section, order) => {
    const open = section.id === expanded
    const score = scoreFields(sectionFields(section), tokens)

    if (score === undefined && !open) {
      return
    }

    ranked.push({
      section: open ? { ...section, options: filterOptions(section.options, tokens) } : section,
      // an open section that the term missed still leads, since what it holds is what the
      // term is narrowing
      score: score ?? Number.POSITIVE_INFINITY,
      order,
    })
  })

  ranked.sort((a, b) => b.score - a.score || a.order - b.order)

  return ranked.map((entry) => entry.section)
}
