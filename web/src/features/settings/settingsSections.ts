import type { ListAction } from '@/helpers/listActions'
import { dropGuesses } from '@/helpers/dropGuesses'
import { MATCH_TIERS, type MatchTier } from '@/helpers/matchTiers'
import { matchFields } from '@/helpers/scoreFields'
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
 * A row that can be taken out of its section on its own, the way an admin entry is deleted: a
 * kept page, an excluded domain.
 */
export interface SettingsItem {
  readonly kind: 'item'
  readonly id: string
  readonly label: string
  /** One line under the name, saying what the row stands for */
  readonly detail: string
  /** Shown in the trail at rest, ahead of the word that removes it */
  readonly note?: string
  /** What removing it does, for assistive technology, since the trail word alone reads as loose text */
  readonly removeTitle: string
  /** Asks for a second press first, for a removal nothing undoes */
  readonly confirm?: boolean
  readonly remove: () => Promise<void>
}

/**
 * A row holding a text field that adds to its section, opened in place the way an admin add row
 * opens its form.
 */
export interface SettingsField {
  readonly kind: 'field'
  readonly id: string
  readonly label: string
  /** One line under the name, saying what adding one does */
  readonly detail: string
  /** Names the field for assistive technology, where the row's label names the whole row */
  readonly inputLabel: string
  readonly placeholder: string
  /** Word on the button that submits it */
  readonly submitLabel: string
  /** Takes what was typed; answers with why it was refused, or undefined once it is added */
  readonly submit: (value: string) => Promise<string | undefined>
}

/**
 * Items listed a page at a time behind a row that lists the next page, for a list that can run to
 * thousands. A term searches every item, not only the listed ones, and pages what it found.
 */
export interface SettingsPagedItems {
  readonly kind: 'paged'
  readonly id: string
  readonly items: ReadonlyArray<SettingsItem>
  /** How many of the items are listed, the rest waiting behind the row `more` builds */
  readonly shown: number
  /** Builds the row listing the next page, from how many items are not listed yet */
  readonly more: (hidden: number) => ListAction
}

/**
 * A row after a section's options: one that adds, one that is removed on its own, one that acts,
 * or a long run of removable ones listed a page at a time.
 */
export type SettingsRow = SettingsField | SettingsItem | ListAction | SettingsPagedItems

/**
 * One group of preferences, which expands in place the way an admin feature does. Most sections
 * own their rows outright: they are read from and written to this browser, so opening one costs
 * no request and shows nothing that has to be waited for. One whose rows live on the api reads
 * them when it opens instead.
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
  /** Rows after the options, in the order they are listed */
  readonly rows?: ReadonlyArray<SettingsRow>
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
 * Returns the texts an item is searched over.
 * @param {SettingsItem} item - Item to describe
 * @returns {ReadonlyArray<SearchField>} - Weighted fields, the label first
 */
function itemFields(item: SettingsItem): ReadonlyArray<SearchField> {
  return [
    { text: item.label, weight: 1 },
    { text: item.detail, weight: 0.5 },
  ]
}

/**
 * Filters rows down to the ones a term addresses, in their declared order, leaving out the ones
 * only a typo found once another matched literally.
 * @param {ReadonlyArray<T>} rows - Rows to filter
 * @param {(row: T) => ReadonlyArray<SearchField>} fieldsOf - Weighted texts a row is searched over
 * @param {ReadonlyArray<SearchToken>} tokens - Tokens the query split into
 * @returns {ReadonlyArray<T>} - Matching rows, in declared order
 */
function matching<T>(
  rows: ReadonlyArray<T>,
  fieldsOf: (row: T) => ReadonlyArray<SearchField>,
  tokens: ReadonlyArray<SearchToken>,
): ReadonlyArray<T> {
  const matched = rows.flatMap((row) => {
    const match = matchFields(fieldsOf(row), tokens)
    return match ? [{ row, tier: match.tier }] : []
  })

  return dropGuesses(matched).map((entry) => entry.row)
}

/**
 * Filters the rows a term addresses, in their declared order. Only the items are narrowed, paged
 * ones included: the field and the actions act on the section as a whole, the way its restore
 * row does, so a term looking for one item must not take away the row that adds another.
 * @param {ReadonlyArray<SettingsRow>} rows - Rows after a section's options
 * @param {ReadonlyArray<SearchToken>} tokens - Tokens the query split into
 * @returns {ReadonlyArray<SettingsRow>} - Rows left standing, in section order
 */
function filterRows(
  rows: ReadonlyArray<SettingsRow>,
  tokens: ReadonlyArray<SearchToken>,
): ReadonlyArray<SettingsRow> {
  // every item of the section at once, so a literal hit on a loose row sets aside the guesses
  // among the paged ones as well
  const items = rows.flatMap((row) =>
    row.kind === 'paged' ? row.items : row.kind === 'item' ? [row] : [],
  )
  const kept = new Set(matching(items, itemFields, tokens))

  return rows
    .map((row) =>
      row.kind === 'paged' ? { ...row, items: row.items.filter((item) => kept.has(item)) } : row,
    )
    .filter((row) => row.kind !== 'item' || kept.has(row))
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
  return matching(options, optionFields, tokens)
}

/**
 * Narrows an open section to what a term addresses inside it.
 * @param {SettingsSection} section - Section whose rows are on screen
 * @param {ReadonlyArray<SearchToken>} tokens - Tokens the query split into
 * @returns {SettingsSection} - The same section, holding only the rows the term left
 */
function narrow(section: SettingsSection, tokens: ReadonlyArray<SearchToken>): SettingsSection {
  return {
    ...section,
    options: filterOptions(section.options, tokens),
    ...(section.rows ? { rows: filterRows(section.rows, tokens) } : {}),
  }
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

  const ranked: Array<{
    section: SettingsSection
    score: number
    tier: MatchTier | undefined
    order: number
  }> = []

  sections.forEach((section, order) => {
    const open = section.id === expanded
    const match = matchFields(sectionFields(section), tokens)

    if (!match && !open) {
      return
    }

    ranked.push({
      section: open ? narrow(section, tokens) : section,
      // an open section that the term missed still leads, since what it holds is what the
      // term is narrowing
      score: match?.score ?? Number.POSITIVE_INFINITY,
      // an open section is never dropped, though a literal hit on it still sets guesses aside
      tier: open && match?.tier === MATCH_TIERS.TYPO ? undefined : match?.tier,
      order,
    })
  })

  return [...dropGuesses(ranked)]
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((entry) => entry.section)
}
