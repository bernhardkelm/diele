/**
 * The admin contract. A feature declares the shape of one of its rows and the client renders a
 * form from that declaration, which is what lets a connector be added without touching the web
 * app at all.
 */

/**
 * How a feature's entries render. A feature declares what it produces and the client already
 * knows how to draw each.
 */
export type DisplayMode = 'card' | 'row' | 'suggestion' | 'engine' | 'inline'

/** The control a field needs, which is what the admin form renders from. */
export type InputMode =
  | 'text'
  | 'url'
  | 'template'
  | 'secret'
  | 'icon'
  | 'color'
  | 'toggle'
  | 'number'
  | 'select'
  | 'keywords'

/**
 * What the runtime may call on a connector. Derived from the methods a module implements
 * rather than declared, so a module cannot claim something it does not do.
 */
export type Capability = 'entries' | 'health' | 'signals' | 'search'

export interface ApiFieldSpec {
  readonly key: string
  readonly label: string
  readonly input: InputMode
  readonly required?: boolean
  readonly placeholder?: string
  /**
   * What a blank form starts this field at. Only needed where the control cannot advertise the
   * default itself: a text box says it with its placeholder, a checkbox has nowhere to say it,
   * and one drawn unticked over a setting that is really on would be lying.
   */
  readonly default?: unknown
  /** One line under the control, for a field whose name does not carry its meaning */
  readonly hint?: string
  /** Set on a field that is shown but cannot be edited yet, so the form says so */
  readonly unavailable?: string
  /** Choices for a `select`, which the form renders instead of a free text box */
  readonly options?: ReadonlyArray<{ value: string; label: string }>
}

export interface ApiFeature {
  readonly id: string
  readonly label: string
  readonly description: string
  /** `builtin` is configuration diele owns; `connector` reaches an outside service */
  readonly kind: 'builtin' | 'connector'
  /** Where a feature's entries show up, which is prose about the page */
  readonly produces: ReadonlyArray<DisplayMode>
  /**
   * What the runtime may ask of a connector, which is a different question from `produces`:
   * one says where output lands, the other says who calls it and on what clock. Absent on a
   * built-in.
   */
  readonly capabilities?: ReadonlyArray<Capability>
  /** The shape of one row, which is what the list editor renders */
  readonly fields: ReadonlyArray<ApiFieldSpec>
  /**
   * Where this feature's rows are read and written. Absent on a feature that owns none, which
   * is what keeps the client from having to know which endpoint belongs to which feature.
   */
  readonly collection?: string
  /** How many rows exist, and how many of those are on */
  readonly count: number
  readonly enabledCount: number
  /** Present on a feature that cannot be opened, saying why in one line */
  readonly unavailable?: string
  /**
   * Which kind of unavailable it is, so the UI can label it without reading the sentence.
   * `planned` has no code behind it yet; `blocked` is built and working but cannot be used
   * until something outside it is configured. Calling the second one "soon" would be wrong:
   * nothing is coming, the deployment is missing a value.
   */
  readonly unavailableReason?: 'planned' | 'blocked'
  /**
   * Set on a feature the whole portal can be told to ignore, which is not the same as having
   * no rows: local port probing costs a request per port on every load, so an instance that is
   * not a development machine turns it off outright.
   */
  readonly toggleable?: boolean
  /**
   * Set on a feature that owns no rows and is only a switch. Separate from `kind`, which says
   * where a feature comes from rather than what shape it is: a connector can be one of these
   * too, once it is live but has nothing configurable yet.
   */
  readonly switchOnly?: boolean
  readonly enabled?: boolean
  /** One line explaining what turning the feature off means */
  readonly toggleHint?: string
}

/** One editable row, whose shape is described by its feature's fields. */
export type ApiRow = Record<string, unknown> & {
  id: number
  enabled?: boolean
  /** Built-in rows the admin view shows but cannot edit */
  readonly?: boolean
}
