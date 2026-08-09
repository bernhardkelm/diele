import type { ApiFieldSpec, DisplayMode, EntryAction, HealthState } from '@diele/common'

/**
 * What a connectivity check is given. Narrower than a run's context on purpose: it happens
 * before anything is stored, so there is no id or cursor to hand it.
 */
export interface VerifyContext {
  /** Already validated by the module's own parseConfig */
  readonly config: Readonly<Record<string, unknown>>
  readonly secrets: Readonly<Record<string, string>>
  readonly signal: AbortSignal
}

export interface ConnectorContext {
  readonly id: number
  readonly label: string
  /** Already validated by the module's own parseConfig, so a handler never re-checks it */
  readonly config: Readonly<Record<string, unknown>>
  /** Decrypted for this call and not held; an unset key is absent rather than empty */
  readonly secrets: Readonly<Record<string, string>>
  /** Aborted when the run passes its budget or the process is going down */
  readonly signal: AbortSignal
  /** What the last run handed back, for a source that pages incrementally */
  readonly cursor: string | null
}

export interface ProducedEntry {
  /** Stable within this connector; the runtime prefixes type and instance to make the ref */
  readonly localRef: string
  readonly kind: DisplayMode
  readonly label: string
  readonly detail?: string
  readonly url: string
  readonly keywords?: ReadonlyArray<string>
  /** Expanded here rather than templated on the wire, so the client renders and never builds */
  readonly actions?: ReadonlyArray<EntryAction>
  /** What the list orders by, compared as text; an ISO date or a name */
  readonly sortKey?: string
  /** ISO timestamp, rendered as relative time when present */
  readonly timestamp?: string
  /** localRef of the group or org this belongs under */
  readonly parentLocalRef?: string
  /** Offered only while a term is being searched, never on the resting page */
  readonly searchOnly?: boolean
  /** Selector a health connector can use before anyone binds one by hand */
  readonly healthRef?: string
}

export interface EntriesResult {
  readonly entries: ReadonlyArray<ProducedEntry>
  readonly cursor?: string
  /**
   * Set when the run reached only part of its source. The runtime then keeps untouched rows
   * standing instead of sweeping them, so one unreachable group cannot empty a section.
   */
  readonly partial?: boolean
}

/** The reading a module hands back, which is what the wire type is built from. */
export interface HealthReading {
  readonly state: HealthState
  /** Share of the last 24h the target was up, 0-1; absent when the source reports none */
  readonly uptime?: number
  /** The source's own name for what it measured, shown in the dot's title */
  readonly detail?: string
}

export interface HealthRequest {
  readonly ref: string
  /** The binding someone made, or the producer's suggestion, or nothing at all */
  readonly selector?: string
  /** What the entry points at, for a connector that matches by hostname */
  readonly url: string
  readonly label: string
}

export interface Signal {
  /** Stable while the condition holds, so a banner does not re-animate on every poll */
  readonly id: string
  readonly severity: 'info' | 'warning' | 'critical'
  readonly label: string
  readonly detail?: string
  readonly href?: string
  readonly since?: string
}

export interface SearchHit {
  readonly localRef: string
  readonly label: string
  readonly detail?: string
  readonly url: string
}

/**
 * One integration. Every capability method is optional, and which ones exist is what the
 * capability list is read from.
 */
export interface ConnectorModule {
  readonly type: string
  readonly label: string
  readonly description: string
  /** Short tag rows carry when several kinds of source mix in one list, e.g. `gl` */
  readonly mark?: string
  /** Where this connector's entries show up, which is admin-facing prose */
  readonly produces: ReadonlyArray<DisplayMode>
  /** The admin form renders from these, the same ApiFieldSpec the built-ins use */
  readonly fields: ReadonlyArray<ApiFieldSpec>
  /**
   * The field this decorator needs on each entry it is bound to, declared here rather than by
   * the entry's own feature: what identifies a target is the decorator's business, and a card
   * knows nothing about monitor names or PromQL. Only read from a module implementing
   * `resolveHealth`; its `showWhen` is filled in by the feature list.
   */
  readonly healthSelectorField?: ApiFieldSpec
  /** Keys of `fields` that are write-only, so the API can refuse to read them back */
  readonly secretKeys: ReadonlyArray<string>
  /** Validates and normalises config before anything is stored or run against it */
  readonly parseConfig: (input: unknown) => Record<string, unknown>
  readonly defaultIntervalSeconds?: number

  /**
   * Answers whether these settings actually reach the source, cheaply enough to run on every
   * save. Throws with a message naming what is wrong; storing is refused on that.
   */
  readonly verify?: (context: VerifyContext) => Promise<void>

  readonly collect?: (context: ConnectorContext) => Promise<EntriesResult>
  readonly resolveHealth?: (
    context: ConnectorContext,
    requests: ReadonlyArray<HealthRequest>,
  ) => Promise<ReadonlyMap<string, HealthReading>>
  readonly readSignals?: (context: ConnectorContext) => Promise<ReadonlyArray<Signal>>
  readonly search?: (context: ConnectorContext, query: string) => Promise<ReadonlyArray<SearchHit>>
}
