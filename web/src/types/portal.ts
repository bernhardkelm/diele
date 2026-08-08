// The shapes the launcher searches over. Discriminated by `kind`, which is the *render shape*
// rather than where the entry came from: a GitLab repo and a GitHub repo are both `row`, so a
// second forge needs no case of its own anywhere in here.

/** What the launcher draws a target as. */
export type TargetKind = 'card' | 'row' | 'suggestion' | 'command'

export interface LaunchAction {
  /** Short label shown in a row; empty for the default action, which is the row itself */
  readonly label: string
  /** What the action opens, used for titles and screen reader labels */
  readonly title: string
  readonly href: string
}

interface BaseTarget {
  /**
   * Stable identity, unique across every source. Keys the render, the launch history and the
   * status map, none of which may key on the url: renaming a repo changes its url and would
   * silently drop everything the portal had learned about it.
   */
  readonly ref: string
  readonly kind: TargetKind
  readonly name: string
  readonly url: string
  /** Extra terms that match this target, beyond its name and url */
  readonly keywords?: ReadonlyArray<string>
  /** Offered only while a term is being searched, so it stays off the resting page */
  readonly searchOnly?: boolean
  /** Everywhere this opens, default first; absent means the url is the only one */
  readonly actions?: ReadonlyArray<LaunchAction>
}

export interface CardTarget extends BaseTarget {
  readonly kind: 'card'
  /** Raw inline SVG markup (fill-less, themed via `currentColor`) */
  readonly icon: string
  /** Brand accent applied on hover/focus */
  readonly color: string
}

export interface RowTarget extends BaseTarget {
  readonly kind: 'row'
  /** Namespace shown as the row's second column, e.g. `example-group` */
  readonly detail?: string
  /** ISO timestamp of the last activity, used for ordering and the relative time column */
  readonly timestamp?: string
  /** Ref of the group this row belongs under */
  readonly parentRef?: string
  /** Which connector produced it, so a section can be labelled by its source */
  readonly connectorId?: number
}

export interface SuggestionTarget extends BaseTarget {
  readonly kind: 'suggestion'
  /** Second column text; falls back to the url's host when absent */
  readonly display?: string
  /** Built from the typed term rather than saved here, so opening it is worth recording */
  readonly adHoc?: true
}

export interface CommandTarget extends BaseTarget {
  readonly kind: 'command'
  /** Never navigated to; a launch target is required to carry one */
  readonly url: ''
  /** One line under the name, saying what running it does */
  readonly hint: string
  /** Leaves the term standing after running, for an entry meant to be run several times */
  readonly keepsQuery?: boolean
  readonly run: () => void
}

/** Everything the launcher searches over. */
export type PortalTarget = CardTarget | RowTarget | SuggestionTarget | CommandTarget

export interface SearchEngine {
  readonly id: string
  /** Shown on the chip next to the input */
  readonly name: string
  /** Query url, with `{query}` standing in for the percent-encoded term */
  readonly urlTemplate: string
}
