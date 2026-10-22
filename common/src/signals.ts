/**
 * What `GET /api/signals` serves: the conditions a connector currently reports as firing, which
 * the portal draws above the launcher.
 *
 * Separate from the readings for the reason those are separate from the entries: a reading is
 * keyed by the entry it decorates and answers "is this card up", while a signal belongs to no
 * entry at all and answers "is something wrong right now". They also have switches of their own,
 * so one being off must not take the other with it.
 */

/**
 * How loud a signal is, in the words the sources themselves use. Which of these actually reach
 * the portal is the source's own setting: a cluster whose `info` tier is two permanently unhappy
 * CPU alerts wants a different floor than one where `info` is rare and worth reading.
 */
export type SignalSeverity = 'info' | 'warning' | 'critical'

export interface ApiSignal {
  /** Stable while the condition holds, so a line does not re-key on every poll */
  readonly id: string
  readonly severity: SignalSeverity
  /** What is firing, in the source's own words */
  readonly label: string
  /**
   * The source's own description of it. Served to an admin only: an alert's annotations quote
   * the instance and the expression, which says which internal hosts exist and how they answer.
   */
  readonly detail?: string
  /** Where the source shows this condition in full */
  readonly href?: string
  /** ISO timestamp of when it started firing, rendered as relative time */
  readonly since?: string
}

/**
 * Which signals are quietened, in the two scopes a silence can sit in. Shaped like the hidden
 * entries' own sets, because it answers the same question about a different thing.
 */
export interface SilencedIds {
  /** Quietened for the whole portal by an admin, which nobody else may lift */
  readonly all: ReadonlyArray<string>
  /** Quietened by the person asking, for themselves alone */
  readonly mine: ReadonlyArray<string>
}

export interface ApiSignals {
  /**
   * Worst first, then longest-firing first; empty when nothing is firing or the feature is off.
   *
   * Carries the quietened ones too, the way the entries carry the hidden ones: a list that is
   * managed has to show what it is holding back in order to bring it back, and a silence is a
   * display preference rather than a permission. Anything that must not be seen at all belongs
   * behind the source's own token.
   */
  readonly signals: ReadonlyArray<ApiSignal>
  /** Which of the above to keep out of the firing list, and which scope quietened each */
  readonly silenced: SilencedIds
  /**
   * How many are firing in all, before the cap on how many are served. The count a summary line
   * reads, so a portal holding more than it sends still says how much is wrong.
   */
  readonly total: number
  /** Seconds until the client should ask again */
  readonly pollSeconds: number
}
